#pragma once

#include "ArizonaBridgeTest.h"

#include <cstdint>
#include <string>

struct BridgeCommandEnvelope {
    std::string id;
    std::uint64_t seq = 0;
    std::string command;
    std::string show_alert_message;
};

struct BridgeProtocolState {
    DWORD client_pid = 0;
    std::uint64_t last_seq = 0;
};

bool TryValidateBridgeCommand(
    const std::string& payload,
    DWORD client_pid,
    BridgeProtocolState& state,
    BridgeCommandEnvelope& command,
    std::string& error);
