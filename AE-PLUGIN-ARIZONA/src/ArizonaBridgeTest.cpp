#include "ArizonaBridgeTest.h"

#include "BridgeProtocol.h"
#include "BridgeSecurity.h"
#include "BridgeContext.h"
#include "actions/MoveLayersToMarkers.h"
#include "actions/RenderQueueAction.h"
#include "actions/ShowAlert.h"

#include <atomic>
#include <mutex>
#include <queue>
#include <string>

static const wchar_t* S_pipe_name = L"\\\\.\\pipe\\arizona-aegp-bridge";
static AEGP_PluginID S_my_id = 0L;
static SPBasicSuite* sP = nullptr;
static std::atomic<bool> S_pipe_started(false);
static std::mutex S_command_mutex;
static std::queue<BridgeCommandEnvelope> S_commands;
static std::mutex S_protocol_mutex;
static BridgeProtocolState S_protocol_state;

static BridgeContext CurrentContext()
{
    BridgeContext context;
    context.plugin_id = S_my_id;
    context.sp = sP;
    return context;
}

static void QueueCommand(const BridgeCommandEnvelope& command)
{
    std::lock_guard<std::mutex> lock(S_command_mutex);
    S_commands.push(command);
}

static bool PopCommand(BridgeCommandEnvelope& command)
{
    std::lock_guard<std::mutex> lock(S_command_mutex);
    if (S_commands.empty()) {
        return false;
    }

    command = S_commands.front();
    S_commands.pop();
    return true;
}

static bool ValidateCommandForClient(
    const std::string& raw_command,
    DWORD client_pid,
    BridgeCommandEnvelope& command)
{
    std::string error;
    std::lock_guard<std::mutex> lock(S_protocol_mutex);
    return TryValidateBridgeCommand(raw_command, client_pid, S_protocol_state, command, error);
}

static void HandleQueuedCommand(const BridgeCommandEnvelope& queued_command)
{
    const std::string& command = queued_command.command;
    const BridgeContext context = CurrentContext();

    if (command == "show_alert") {
        RunShowAlert(context, queued_command.show_alert_message);
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
        return;
    }

    if (command == "render") {
        RunQueueRenderOutputs(context);
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

    BridgeCommandEnvelope command;
    while (PopCommand(command)) {
        HandleQueuedCommand(command);
    }

    return A_Err_NONE;
}

static DWORD WINAPI PipeServerThread(LPVOID)
{
    PipeSecurityAttributes pipe_security;

    while (true) {
        HANDLE pipe = CreateNamedPipeW(
            S_pipe_name,
            PIPE_ACCESS_INBOUND,
            PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
            1,
            16384,
            16384,
            0,
            pipe_security.get());

        if (pipe == INVALID_HANDLE_VALUE) {
            Sleep(1000);
            continue;
        }

        const BOOL connected =
            ConnectNamedPipe(pipe, nullptr) ? TRUE : (GetLastError() == ERROR_PIPE_CONNECTED);

        DWORD client_pid = 0;
        std::wstring client_image_path;
        std::string validation_error;
        if (connected && IsAllowedPipeClient(pipe, client_pid, client_image_path, validation_error)) {
            char buffer[4096] = {};
            DWORD bytes_read = 0;
            std::string message;
            bool payload_too_large = false;

            while (ReadFile(pipe, buffer, sizeof(buffer), &bytes_read, nullptr) && bytes_read > 0) {
                if (message.size() + bytes_read > 16384) {
                    payload_too_large = true;
                    break;
                }
                message.append(buffer, bytes_read);
                if (bytes_read < sizeof(buffer)) {
                    break;
                }
            }

            if (!message.empty() && !payload_too_large) {
                BridgeCommandEnvelope command;
                if (ValidateCommandForClient(message, client_pid, command)) {
                    QueueCommand(command);
                }
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
