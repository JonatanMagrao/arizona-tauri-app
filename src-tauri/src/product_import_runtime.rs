use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

const IMPORT_IN_PROGRESS_MESSAGE: &str =
    "Já existe uma cópia de produtos em andamento. Aguarde a conclusão para iniciar outra.";

#[derive(Default)]
pub(crate) struct ProductImportRuntime {
    active: Arc<AtomicBool>,
}

struct ImportGuard(Arc<AtomicBool>);

impl Drop for ImportGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

impl ProductImportRuntime {
    pub(crate) async fn run<T, F>(&self, operation: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce() -> Result<T, String> + Send + 'static,
    {
        self.active
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| IMPORT_IN_PROGRESS_MESSAGE.to_string())?;

        let guard = ImportGuard(Arc::clone(&self.active));
        tauri::async_runtime::spawn_blocking(move || {
            // Keep the reservation with the actual worker even if its caller disappears.
            let _guard = guard;
            operation()
        })
        .await
        .map_err(|error| format!("Não foi possível concluir a cópia dos produtos: {error}"))?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        future::Future,
        pin::Pin,
        sync::mpsc::{self, Sender},
        task::{Context, Wake, Waker},
        thread,
        time::Duration,
    };

    const TIMEOUT: Duration = Duration::from_secs(10);

    struct NoopWake;

    impl Wake for NoopWake {
        fn wake(self: Arc<Self>) {}
    }

    fn start_pending<F: Future>(future: Pin<&mut F>) {
        let waker = Waker::from(Arc::new(NoopWake));
        let mut context = Context::from_waker(&waker);
        assert!(future.poll(&mut context).is_pending());
    }

    #[test]
    fn runs_blocking_work_on_a_different_thread() {
        let runtime = ProductImportRuntime::default();
        let caller_thread = thread::current().id();

        let worker_thread =
            tauri::async_runtime::block_on(runtime.run(|| Ok(thread::current().id()))).unwrap();

        assert_ne!(worker_thread, caller_thread);
    }

    #[test]
    fn rejects_another_import_until_the_worker_finishes() {
        let runtime = ProductImportRuntime::default();
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let mut first = Box::pin(runtime.run(move || {
            started_tx.send(()).unwrap();
            release_rx
                .recv_timeout(TIMEOUT)
                .map_err(|error| error.to_string())?;
            Ok(1)
        }));
        start_pending(first.as_mut());
        started_rx.recv_timeout(TIMEOUT).unwrap();

        let second = tauri::async_runtime::block_on(
            runtime.run(|| -> Result<(), String> { panic!("Concurrent import was started") }),
        );
        assert_eq!(second.unwrap_err(), IMPORT_IN_PROGRESS_MESSAGE);

        release_tx.send(()).unwrap();
        assert_eq!(tauri::async_runtime::block_on(first).unwrap(), 1);
        assert_eq!(tauri::async_runtime::block_on(runtime.run(|| Ok(2))), Ok(2));
    }

    #[test]
    fn releases_the_reservation_after_an_operation_error() {
        let runtime = ProductImportRuntime::default();

        let error = tauri::async_runtime::block_on(
            runtime.run(|| Err::<(), _>("Falha de leitura".to_string())),
        );

        assert_eq!(error.unwrap_err(), "Falha de leitura");
        assert_eq!(
            tauri::async_runtime::block_on(runtime.run(|| Ok(()))),
            Ok(())
        );
    }

    #[test]
    fn releases_the_reservation_after_a_worker_panic() {
        let runtime = ProductImportRuntime::default();

        let error = tauri::async_runtime::block_on(
            runtime.run(|| -> Result<(), String> { panic!("Test worker panic") }),
        );

        assert!(error
            .unwrap_err()
            .contains("Não foi possível concluir a cópia dos produtos"));
        assert_eq!(
            tauri::async_runtime::block_on(runtime.run(|| Ok(()))),
            Ok(())
        );
    }

    #[test]
    fn dropping_the_caller_keeps_the_reservation_until_work_finishes() {
        struct CompletionSignal(Sender<()>);

        impl Drop for CompletionSignal {
            fn drop(&mut self) {
                let _ = self.0.send(());
            }
        }

        let runtime = ProductImportRuntime::default();
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let (finished_tx, finished_rx) = mpsc::channel();
        let mut first = Box::pin(runtime.run(move || {
            started_tx.send(()).unwrap();
            release_rx
                .recv_timeout(TIMEOUT)
                .map_err(|error| error.to_string())?;
            // The detached task drops its result after the worker's guard has been released.
            Ok(CompletionSignal(finished_tx))
        }));
        start_pending(first.as_mut());
        started_rx.recv_timeout(TIMEOUT).unwrap();
        drop(first);

        let second = tauri::async_runtime::block_on(
            runtime.run(|| -> Result<(), String> { panic!("Detached import was still active") }),
        );
        assert_eq!(second.unwrap_err(), IMPORT_IN_PROGRESS_MESSAGE);

        release_tx.send(()).unwrap();
        finished_rx.recv_timeout(TIMEOUT).unwrap();
        assert_eq!(
            tauri::async_runtime::block_on(runtime.run(|| Ok(()))),
            Ok(())
        );
    }
}
