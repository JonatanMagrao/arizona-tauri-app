use std::{
    collections::VecDeque,
    ffi::OsString,
    io::{BufRead, BufReader, Read},
    path::PathBuf,
    process::{Child, Command, ExitStatus, Stdio},
    sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CALLBACK_INTERVAL: Duration = Duration::from_millis(500);
const OUTPUT_DRAIN_TIMEOUT: Duration = Duration::from_millis(250);
const MAX_OUTPUT_TAIL_BYTES: usize = 64 * 1024;
const MAX_OUTPUT_LINE_BYTES: usize = 8 * 1024;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Debug)]
pub(crate) struct AerenderSpec {
    pub(crate) executable: PathBuf,
    pub(crate) project: PathBuf,
    pub(crate) composition: String,
    pub(crate) output_module_template: String,
    pub(crate) output: PathBuf,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AerenderResult {
    pub(crate) status_success: bool,
    pub(crate) exit_code: Option<i32>,
    pub(crate) output_tail: String,
}

/// Runs a single aerender output under process-tree supervision.
///
/// `on_tick` receives sanitized output lines as they arrive and `None` at a
/// regular interval. Returning `false` requests cancellation. The collected
/// output is intentionally bounded; callers should keep it in local
/// diagnostics only.
pub(crate) fn run_aerender<F>(spec: &AerenderSpec, mut on_tick: F) -> Result<AerenderResult, String>
where
    F: FnMut(Option<&str>) -> bool,
{
    let args = aerender_args(spec);
    let mut command = Command::new(&spec.executable);
    command
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command.spawn().map_err(|error| {
        format!(
            "failed to start aerender executable {}: {error}",
            spec.executable.display()
        )
    })?;
    let mut process_job = match ProcessJob::assign(&child) {
        Ok(job) => Some(job),
        Err(error) => {
            // Without tree supervision a Tauri crash could leave aerender
            // publishing after its lease expired. Fail closed.
            terminate_process_tree_fallback(&mut child);
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("failed to supervise aerender process: {error}"));
        }
    };

    let Some(stdout) = child.stdout.take() else {
        terminate_process_tree(&mut child, &mut process_job);
        let _ = child.wait();
        return Err("aerender stdout pipe was not created".to_string());
    };
    let Some(stderr) = child.stderr.take() else {
        terminate_process_tree(&mut child, &mut process_job);
        let _ = child.wait();
        return Err("aerender stderr pipe was not created".to_string());
    };

    // Bound queued output as well as the retained tail. If a callback takes
    // longer than usual, backpressure reaches the child pipe instead of
    // growing the app's memory without limit.
    let (sender, receiver) = mpsc::sync_channel(256);
    let readers = vec![
        spawn_output_reader(stdout, sender.clone()),
        spawn_output_reader(stderr, sender.clone()),
    ];
    drop(sender);

    let mut output_tail = OutputTail::new(MAX_OUTPUT_TAIL_BYTES);
    let mut next_callback = Instant::now() + CALLBACK_INTERVAL;
    let mut cancelled = !on_tick(None);
    let status = loop {
        if cancelled {
            terminate_process_tree(&mut child, &mut process_job);
            break child
                .wait()
                .map_err(|error| format!("failed to wait for cancelled aerender: {error}"))?;
        }

        let now = Instant::now();
        let wait_for = next_callback
            .saturating_duration_since(now)
            .min(Duration::from_millis(100));

        match receiver.recv_timeout(wait_for) {
            Ok(OutputEvent::Line(line)) => {
                output_tail.push(&line);
                if !on_tick(Some(&line)) {
                    cancelled = true;
                }
            }
            Ok(OutputEvent::Closed) | Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => thread::sleep(wait_for),
        }

        let now = Instant::now();
        if now >= next_callback {
            if !on_tick(None) {
                cancelled = true;
            }
            next_callback = now + CALLBACK_INTERVAL;
        }

        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(error) => {
                terminate_process_tree(&mut child, &mut process_job);
                let _ = child.wait();
                release_readers(readers);
                return Err(format!("failed to inspect aerender process: {error}"));
            }
        }
    };

    // Closing a Windows Job Object after the main process exits also removes
    // any unexpected descendants that retained one of the output pipes.
    drop(process_job);
    drain_output(
        &receiver,
        &mut output_tail,
        &mut on_tick,
        OUTPUT_DRAIN_TIMEOUT,
    );
    release_readers(readers);

    Ok(result_from_status(status, output_tail.render()))
}

fn aerender_args(spec: &AerenderSpec) -> Vec<OsString> {
    vec![
        OsString::from("-v"),
        OsString::from("ERRORS_AND_PROGRESS"),
        OsString::from("-project"),
        spec.project.as_os_str().to_owned(),
        OsString::from("-comp"),
        OsString::from(&spec.composition),
        OsString::from("-OMtemplate"),
        OsString::from(&spec.output_module_template),
        OsString::from("-output"),
        spec.output.as_os_str().to_owned(),
    ]
}

fn result_from_status(status: ExitStatus, output_tail: String) -> AerenderResult {
    AerenderResult {
        status_success: status.success(),
        exit_code: status.code(),
        output_tail,
    }
}

enum OutputEvent {
    Line(String),
    Closed,
}

fn spawn_output_reader<R>(reader: R, sender: SyncSender<OutputEvent>) -> JoinHandle<()>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        let mut bytes = Vec::new();
        loop {
            bytes.clear();
            // `read_until` normally grows without a bound when a process emits
            // one malformed line. `take` segments such output while keeping
            // memory bounded before sanitization/truncation.
            match reader
                .by_ref()
                .take((MAX_OUTPUT_LINE_BYTES + 1) as u64)
                .read_until(b'\n', &mut bytes)
            {
                Ok(0) => break,
                Ok(_) => {
                    if let Some(line) = parse_output_line(&bytes) {
                        if sender.send(OutputEvent::Line(line)).is_err() {
                            return;
                        }
                    }
                }
                Err(_) => break,
            }
        }
        let _ = sender.send(OutputEvent::Closed);
    })
}

fn drain_output<F>(
    receiver: &Receiver<OutputEvent>,
    output_tail: &mut OutputTail,
    on_tick: &mut F,
    timeout: Duration,
) where
    F: FnMut(Option<&str>) -> bool,
{
    let deadline = Instant::now() + timeout;
    let mut closed_readers = 0;
    while closed_readers < 2 {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        match receiver.recv_timeout(remaining) {
            Ok(OutputEvent::Line(line)) => {
                output_tail.push(&line);
                let _ = on_tick(Some(&line));
            }
            Ok(OutputEvent::Closed) => closed_readers += 1,
            Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => break,
        }
    }

    while let Ok(event) = receiver.try_recv() {
        if let OutputEvent::Line(line) = event {
            output_tail.push(&line);
            let _ = on_tick(Some(&line));
        }
    }
}

fn release_readers(readers: Vec<JoinHandle<()>>) {
    for reader in readers {
        if reader.is_finished() {
            let _ = reader.join();
        }
        // A reader that did not finish within the bounded drain period is
        // detached. This prevents a broken child process from hanging the app.
    }
}

fn parse_output_line(bytes: &[u8]) -> Option<String> {
    let bytes = bytes.strip_suffix(b"\n").unwrap_or(bytes);
    let bytes = bytes.strip_suffix(b"\r").unwrap_or(bytes);
    let decoded = String::from_utf8_lossy(bytes);
    let sanitized = strip_terminal_controls(&decoded);
    let sanitized = truncate_tail(&sanitized, MAX_OUTPUT_LINE_BYTES);
    let sanitized = sanitized.trim();
    (!sanitized.is_empty()).then(|| sanitized.to_string())
}

fn strip_terminal_controls(value: &str) -> String {
    #[derive(Clone, Copy)]
    enum State {
        Text,
        Escape,
        ControlSequence,
    }

    let mut result = String::with_capacity(value.len());
    let mut state = State::Text;
    let mut pending_space = false;
    for character in value.chars() {
        match state {
            State::Text if character == '\u{1b}' => state = State::Escape,
            State::Text if character.is_control() => pending_space = !result.is_empty(),
            State::Text => {
                if pending_space && !character.is_whitespace() && !result.ends_with(' ') {
                    result.push(' ');
                }
                pending_space = false;
                result.push(character);
            }
            State::Escape if character == '[' => state = State::ControlSequence,
            State::Escape => state = State::Text,
            State::ControlSequence if ('@'..='~').contains(&character) => state = State::Text,
            State::ControlSequence => {}
        }
    }
    result
}

fn truncate_tail(value: &str, max_bytes: usize) -> &str {
    if value.len() <= max_bytes {
        return value;
    }
    let mut start = value.len() - max_bytes;
    while !value.is_char_boundary(start) {
        start += 1;
    }
    &value[start..]
}

struct OutputTail {
    lines: VecDeque<String>,
    max_bytes: usize,
}

impl OutputTail {
    fn new(max_bytes: usize) -> Self {
        Self {
            lines: VecDeque::new(),
            max_bytes,
        }
    }

    fn push(&mut self, line: &str) {
        if self.max_bytes == 0 || line.is_empty() {
            return;
        }

        let line = truncate_tail(line, self.max_bytes).to_string();
        self.lines.push_back(line);
        while self.rendered_len() > self.max_bytes && self.lines.len() > 1 {
            self.lines.pop_front();
        }

        if self.rendered_len() > self.max_bytes {
            let Some(last) = self.lines.pop_back() else {
                return;
            };
            self.lines
                .push_back(truncate_tail(&last, self.max_bytes).to_string());
        }
    }

    fn rendered_len(&self) -> usize {
        self.lines.iter().map(String::len).sum::<usize>() + self.lines.len().saturating_sub(1)
    }

    fn render(self) -> String {
        self.lines.into_iter().collect::<Vec<_>>().join("\n")
    }
}

#[cfg(windows)]
struct ProcessJob {
    handle: windows_job::Handle,
}

#[cfg(windows)]
impl ProcessJob {
    fn assign(child: &Child) -> Result<Self, String> {
        windows_job::create_and_assign(child).map(|handle| Self { handle })
    }

    fn terminate(&mut self) {
        windows_job::close(self.handle);
        self.handle = std::ptr::null_mut();
    }
}

#[cfg(windows)]
impl Drop for ProcessJob {
    fn drop(&mut self) {
        windows_job::close(self.handle);
        self.handle = std::ptr::null_mut();
    }
}

#[cfg(not(windows))]
struct ProcessJob;

#[cfg(not(windows))]
impl ProcessJob {
    fn assign(_child: &Child) -> Result<Self, String> {
        Ok(Self)
    }

    fn terminate(&mut self) {}
}

fn terminate_process_tree(child: &mut Child, process_job: &mut Option<ProcessJob>) {
    if let Some(job) = process_job.as_mut() {
        job.terminate();
    } else {
        terminate_process_tree_fallback(child);
    }
    let _ = child.kill();
}

#[cfg(windows)]
fn terminate_process_tree_fallback(child: &mut Child) {
    let mut command = Command::new("taskkill.exe");
    command
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW);
    let _ = command.status();
}

#[cfg(not(windows))]
fn terminate_process_tree_fallback(_child: &mut Child) {}

#[cfg(windows)]
mod windows_job {
    use std::{
        ffi::c_void,
        mem::{size_of, zeroed},
        os::windows::io::AsRawHandle,
        process::Child,
        ptr,
    };

    pub(super) type Handle = *mut c_void;

    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS: i32 = 9;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x0000_2000;

    #[repr(C)]
    struct IoCounters {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    struct BasicLimitInformation {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    #[repr(C)]
    struct ExtendedLimitInformation {
        basic_limit_information: BasicLimitInformation,
        io_info: IoCounters,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> Handle;
        fn SetInformationJobObject(
            job: Handle,
            information_class: i32,
            information: *const c_void,
            information_length: u32,
        ) -> i32;
        fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
        fn CloseHandle(object: Handle) -> i32;
    }

    pub(super) fn create_and_assign(child: &Child) -> Result<Handle, String> {
        // SAFETY: Null security/name arguments create an unnamed job owned by
        // this process. The returned handle is validated before further use.
        let handle = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
        if handle.is_null() {
            return Err(format!(
                "CreateJobObjectW failed: {}",
                std::io::Error::last_os_error()
            ));
        }

        // SAFETY: The structure is plain C data and zero is the documented
        // baseline before setting the desired limit flag.
        let mut limits: ExtendedLimitInformation = unsafe { zeroed() };
        limits.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: `handle` is live and `limits` remains valid for the complete
        // call. The information class matches the structure layout.
        let configured = unsafe {
            SetInformationJobObject(
                handle,
                JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
                &limits as *const _ as *const c_void,
                size_of::<ExtendedLimitInformation>() as u32,
            )
        };
        if configured == 0 {
            let error = std::io::Error::last_os_error();
            close(handle);
            return Err(format!("SetInformationJobObject failed: {error}"));
        }

        // SAFETY: `Child` exposes the live process HANDLE it owns. Assignment
        // does not transfer ownership of either handle.
        let assigned =
            unsafe { AssignProcessToJobObject(handle, child.as_raw_handle() as *mut c_void) };
        if assigned == 0 {
            let error = std::io::Error::last_os_error();
            close(handle);
            return Err(format!("AssignProcessToJobObject failed: {error}"));
        }

        Ok(handle)
    }

    pub(super) fn close(handle: Handle) {
        if handle.is_null() {
            return;
        }
        // SAFETY: This module is the sole owner of handles returned from
        // `create_and_assign`, and callers clear their field after closing.
        let _ = unsafe { CloseHandle(handle) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_spec() -> AerenderSpec {
        AerenderSpec {
            executable: PathBuf::from(r"C:\Adobe\aerender.exe"),
            project: PathBuf::from(r"G:\Jobao\Jobinho\Projeto salvo.aep"),
            composition: "EXPORT".to_string(),
            output_module_template: "PROXY".to_string(),
            output: PathBuf::from(r"G:\Jobao\OUT\RENDER\MOV\Projeto.mov"),
        }
    }

    #[test]
    fn builds_the_expected_aerender_argument_order() {
        let spec = sample_spec();

        assert_eq!(
            aerender_args(&spec),
            vec![
                OsString::from("-v"),
                OsString::from("ERRORS_AND_PROGRESS"),
                OsString::from("-project"),
                spec.project.into_os_string(),
                OsString::from("-comp"),
                OsString::from("EXPORT"),
                OsString::from("-OMtemplate"),
                OsString::from("PROXY"),
                OsString::from("-output"),
                spec.output.into_os_string(),
            ]
        );
    }

    #[test]
    fn parses_lossy_output_and_removes_terminal_controls() {
        let line = parse_output_line(b"\x1b[31mPROGRESS:\x1b[0m 12\0frames\xff\r\n").unwrap();

        assert_eq!(line, "PROGRESS: 12 frames�");
    }

    #[test]
    fn ignores_empty_output_lines() {
        assert_eq!(parse_output_line(b"\r\n"), None);
        assert_eq!(parse_output_line(b"\0\r\n"), None);
    }

    #[test]
    fn output_tail_keeps_only_the_newest_complete_entries() {
        let mut tail = OutputTail::new(12);
        tail.push("old");
        tail.push("middle");
        tail.push("new");

        assert_eq!(tail.render(), "middle\nnew");
    }

    #[test]
    fn output_tail_truncates_one_oversized_unicode_line_safely() {
        let mut tail = OutputTail::new(5);
        tail.push("aé1234");

        assert_eq!(tail.render(), "1234");
    }
}
