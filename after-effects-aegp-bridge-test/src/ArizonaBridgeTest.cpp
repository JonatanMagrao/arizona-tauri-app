#include "ArizonaBridgeTest.h"

#include "BridgeContext.h"
#include "actions/MoveLayersToMarkers.h"
#include "actions/ShowAlert.h"

#include <atomic>
#include <cwctype>
#include <mutex>
#include <queue>
#include <string>

static const wchar_t* S_pipe_name = L"\\\\.\\pipe\\arizona-aegp-bridge";
static AEGP_PluginID S_my_id = 0L;
static SPBasicSuite* sP = nullptr;
static std::atomic<bool> S_pipe_started(false);
static std::mutex S_command_mutex;
static std::queue<std::string> S_commands;

static BridgeContext CurrentContext()
{
    BridgeContext context;
    context.plugin_id = S_my_id;
    context.sp = sP;
    return context;
}

static void QueueCommand(const std::string& command)
{
    std::lock_guard<std::mutex> lock(S_command_mutex);
    S_commands.push(command);
}

static bool PopCommand(std::string& command)
{
    std::lock_guard<std::mutex> lock(S_command_mutex);
    if (S_commands.empty()) {
        return false;
    }

    command = S_commands.front();
    S_commands.pop();
    return true;
}

static std::wstring FileNameFromPath(const std::wstring& path)
{
    const size_t slash_pos = path.find_last_of(L"\\/");
    if (slash_pos == std::wstring::npos) {
        return path;
    }

    return path.substr(slash_pos + 1);
}

static bool WideEqualsIgnoreCase(const std::wstring& left, const wchar_t* right)
{
    const std::wstring right_text(right);
    if (left.size() != right_text.size()) {
        return false;
    }

    for (size_t index = 0; index < left.size(); ++index) {
        if (std::towlower(left[index]) != std::towlower(right_text[index])) {
            return false;
        }
    }

    return true;
}

static bool IsAllowedPipeClient(HANDLE pipe)
{
    DWORD client_pid = 0;
    if (!GetNamedPipeClientProcessId(pipe, &client_pid)) {
        return false;
    }

    HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, client_pid);
    if (!process) {
        return false;
    }

    wchar_t image_path[4096] = {};
    DWORD image_path_len = static_cast<DWORD>(sizeof(image_path) / sizeof(image_path[0]));
    const BOOL got_path = QueryFullProcessImageNameW(process, 0, image_path, &image_path_len);
    CloseHandle(process);

    if (!got_path || image_path_len == 0) {
        return false;
    }

    const std::wstring file_name = FileNameFromPath(std::wstring(image_path, image_path_len));
    return WideEqualsIgnoreCase(file_name, L"arizona-app.exe");
}

static std::string JsonStringValue(const std::string& json, const std::string& key)
{
    const std::string quoted_key = "\"" + key + "\"";
    const size_t key_pos = json.find(quoted_key);
    if (key_pos == std::string::npos) {
        return "";
    }

    const size_t colon_pos = json.find(':', key_pos + quoted_key.size());
    if (colon_pos == std::string::npos) {
        return "";
    }

    const size_t start_quote = json.find('"', colon_pos + 1);
    if (start_quote == std::string::npos) {
        return "";
    }

    std::string value;
    bool escaped = false;
    for (size_t index = start_quote + 1; index < json.size(); ++index) {
        const char ch = json[index];
        if (escaped) {
            switch (ch) {
                case 'n': value.push_back('\n'); break;
                case 'r': value.push_back('\r'); break;
                case 't': value.push_back('\t'); break;
                default: value.push_back(ch); break;
            }
            escaped = false;
            continue;
        }

        if (ch == '\\') {
            escaped = true;
            continue;
        }

        if (ch == '"') {
            break;
        }

        value.push_back(ch);
    }

    return value;
}

static void HandleQueuedCommand(const std::string& raw_command)
{
    const std::string command = JsonStringValue(raw_command, "command");
    const BridgeContext context = CurrentContext();

    if (command == "show_alert") {
        std::string message = JsonStringValue(raw_command, "message");
        if (message.empty()) {
            message = "ponte feita";
        }

        RunShowAlert(context, message);
        return;
    }

    if (command == "move_layers_backward") {
        RunMoveLayersToMarkers(context, MarkerPickDirection::Backward);
        return;
    }

    if (command == "move_layers_forward" || command == "move_layers_to_markers") {
        RunMoveLayersToMarkers(context, MarkerPickDirection::Forward);
        return;
    }

    if (command == "move_jump_marker") {
        RunMoveSelectedJumpMarkers(context);
        return;
    }

    if (command == "select_jump_marker_layer") {
        RunSelectLayersWithJumpMarkerAtCurrentTime(context);
        return;
    }

    if (command == "adjust_markers_to_tail") {
        RunAdjustTimelineMarkersToTail(context);
    }
}

static A_Err IdleHook(
    AEGP_GlobalRefcon,
    AEGP_IdleRefcon,
    A_long* max_sleepPL)
{
    if (max_sleepPL) {
        *max_sleepPL = 1;
    }

    std::string command;
    while (PopCommand(command)) {
        HandleQueuedCommand(command);
    }

    return A_Err_NONE;
}

static DWORD WINAPI PipeServerThread(LPVOID)
{
    while (true) {
        HANDLE pipe = CreateNamedPipeW(
            S_pipe_name,
            PIPE_ACCESS_INBOUND,
            PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT,
            1,
            4096,
            4096,
            0,
            nullptr);

        if (pipe == INVALID_HANDLE_VALUE) {
            Sleep(1000);
            continue;
        }

        const BOOL connected =
            ConnectNamedPipe(pipe, nullptr) ? TRUE : (GetLastError() == ERROR_PIPE_CONNECTED);

        if (connected && IsAllowedPipeClient(pipe)) {
            char buffer[4096] = {};
            DWORD bytes_read = 0;
            std::string message;

            while (ReadFile(pipe, buffer, sizeof(buffer), &bytes_read, nullptr) && bytes_read > 0) {
                message.append(buffer, bytes_read);
                if (bytes_read < sizeof(buffer)) {
                    break;
                }
            }

            if (!message.empty()) {
                QueueCommand(message);
            }
        }

        DisconnectNamedPipe(pipe);
        CloseHandle(pipe);
    }
}

static void StartPipeServer()
{
    bool expected = false;
    if (!S_pipe_started.compare_exchange_strong(expected, true)) {
        return;
    }

    HANDLE thread = CreateThread(
        nullptr,
        0,
        PipeServerThread,
        nullptr,
        0,
        nullptr);

    if (thread) {
        CloseHandle(thread);
    } else {
        S_pipe_started = false;
    }
}

A_Err EntryPointFunc(
    SPBasicSuite* pica_basicP,
    A_long,
    A_long,
    AEGP_PluginID aegp_plugin_id,
    AEGP_GlobalRefcon*)
{
    A_Err err = A_Err_NONE;
    A_Err err2 = A_Err_NONE;

    sP = pica_basicP;
    S_my_id = aegp_plugin_id;

    AEGP_SuiteHandler suites(sP);

    ERR(suites.RegisterSuite5()->AEGP_RegisterIdleHook(
        S_my_id,
        IdleHook,
        nullptr));

    StartPipeServer();

    if (err) {
        ERR2(suites.UtilitySuite3()->AEGP_ReportInfo(
            S_my_id,
            "ArizonaBridge: could not start receiver."));
    }

    return err;
}
