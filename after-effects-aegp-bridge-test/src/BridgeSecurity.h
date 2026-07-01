#pragma once

#include "ArizonaBridgeTest.h"

#include <string>

class PipeSecurityAttributes {
public:
    PipeSecurityAttributes();
    ~PipeSecurityAttributes();

    PipeSecurityAttributes(const PipeSecurityAttributes&) = delete;
    PipeSecurityAttributes& operator=(const PipeSecurityAttributes&) = delete;

    SECURITY_ATTRIBUTES* get();

private:
    SECURITY_ATTRIBUTES attributes_;
    PSECURITY_DESCRIPTOR descriptor_;
};

bool IsAllowedPipeClient(
    HANDLE pipe,
    DWORD& client_pid,
    std::wstring& client_image_path,
    std::string& error);
