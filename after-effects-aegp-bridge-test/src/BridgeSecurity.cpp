#include "BridgeSecurity.h"

#include <algorithm>
#include <cctype>
#include <cwctype>
#include <softpub.h>
#include <sddl.h>
#include <vector>
#include <wincrypt.h>
#include <wintrust.h>

#ifndef ARIZONA_TAURI_CERT_SHA256
#define ARIZONA_TAURI_CERT_SHA256 ""
#endif

#ifndef ARIZONA_ALLOW_DEV_AEX_CLIENT
#define ARIZONA_ALLOW_DEV_AEX_CLIENT 0
#endif

namespace {

bool IsConfigured(const char* value)
{
    return value && value[0] != '\0';
}

std::string NormalizeHex(const std::string& value)
{
    std::string normalized;
    normalized.reserve(value.size());

    for (char ch : value) {
        const unsigned char byte = static_cast<unsigned char>(ch);
        if (std::isxdigit(byte)) {
            normalized.push_back(static_cast<char>(std::toupper(byte)));
        }
    }

    return normalized;
}

std::string HexFromBytes(const BYTE* bytes, DWORD byte_count)
{
    static const char* digits = "0123456789ABCDEF";
    std::string hex;
    hex.reserve(static_cast<size_t>(byte_count) * 2);

    for (DWORD index = 0; index < byte_count; ++index) {
        const BYTE byte = bytes[index];
        hex.push_back(digits[(byte >> 4) & 0x0F]);
        hex.push_back(digits[byte & 0x0F]);
    }

    return hex;
}

bool VerifyAuthenticodeTrust(const std::wstring& path, std::string& error)
{
    WINTRUST_FILE_INFO file_info = {};
    file_info.cbStruct = sizeof(file_info);
    file_info.pcwszFilePath = path.c_str();

    WINTRUST_DATA trust_data = {};
    trust_data.cbStruct = sizeof(trust_data);
    trust_data.dwUIChoice = WTD_UI_NONE;
    trust_data.fdwRevocationChecks = WTD_REVOKE_WHOLECHAIN;
    trust_data.dwUnionChoice = WTD_CHOICE_FILE;
    trust_data.dwStateAction = WTD_STATEACTION_VERIFY;
    trust_data.dwProvFlags = WTD_CACHE_ONLY_URL_RETRIEVAL | WTD_REVOCATION_CHECK_CHAIN;
    trust_data.pFile = &file_info;

    GUID policy = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    const LONG status = WinVerifyTrust(nullptr, &policy, &trust_data);

    trust_data.dwStateAction = WTD_STATEACTION_CLOSE;
    (void)WinVerifyTrust(nullptr, &policy, &trust_data);

    if (status != ERROR_SUCCESS) {
        error = "tauri_signature_invalid";
        return false;
    }

    return true;
}

bool ReadSignerCertificateSha256(const std::wstring& path, std::string& thumbprint, std::string& error)
{
    HCERTSTORE store = nullptr;
    HCRYPTMSG message = nullptr;
    DWORD encoding = 0;
    DWORD content_type = 0;
    DWORD format_type = 0;

    if (!CryptQueryObject(
            CERT_QUERY_OBJECT_FILE,
            path.c_str(),
            CERT_QUERY_CONTENT_FLAG_PKCS7_SIGNED_EMBED,
            CERT_QUERY_FORMAT_FLAG_BINARY,
            0,
            &encoding,
            &content_type,
            &format_type,
            &store,
            &message,
            nullptr)) {
        error = "tauri_signature_certificate_missing";
        return false;
    }

    DWORD signer_info_size = 0;
    if (!CryptMsgGetParam(message, CMSG_SIGNER_INFO_PARAM, 0, nullptr, &signer_info_size)) {
        if (message) {
            CryptMsgClose(message);
        }
        if (store) {
            CertCloseStore(store, 0);
        }
        error = "tauri_signature_signer_missing";
        return false;
    }

    std::vector<BYTE> signer_info_buffer(signer_info_size);
    if (!CryptMsgGetParam(
            message,
            CMSG_SIGNER_INFO_PARAM,
            0,
            signer_info_buffer.data(),
            &signer_info_size)) {
        if (message) {
            CryptMsgClose(message);
        }
        if (store) {
            CertCloseStore(store, 0);
        }
        error = "tauri_signature_signer_invalid";
        return false;
    }

    const CMSG_SIGNER_INFO* signer_info =
        reinterpret_cast<const CMSG_SIGNER_INFO*>(signer_info_buffer.data());

    CERT_INFO cert_info = {};
    cert_info.Issuer = signer_info->Issuer;
    cert_info.SerialNumber = signer_info->SerialNumber;

    PCCERT_CONTEXT cert = CertFindCertificateInStore(
        store,
        X509_ASN_ENCODING | PKCS_7_ASN_ENCODING,
        0,
        CERT_FIND_SUBJECT_CERT,
        &cert_info,
        nullptr);

    if (!cert) {
        if (message) {
            CryptMsgClose(message);
        }
        if (store) {
            CertCloseStore(store, 0);
        }
        error = "tauri_signature_certificate_not_found";
        return false;
    }

    BYTE hash[32] = {};
    DWORD hash_size = sizeof(hash);
    const BOOL hashed = CryptHashCertificate(
        0,
        CALG_SHA_256,
        0,
        cert->pbCertEncoded,
        cert->cbCertEncoded,
        hash,
        &hash_size);

    if (hashed) {
        thumbprint = HexFromBytes(hash, hash_size);
    }

    CertFreeCertificateContext(cert);
    if (message) {
        CryptMsgClose(message);
    }
    if (store) {
        CertCloseStore(store, 0);
    }

    if (!hashed) {
        error = "tauri_signature_thumbprint_failed";
        return false;
    }

    return true;
}

bool IsExpectedPublisherCertificate(const std::wstring& path, std::string& error)
{
    const std::string expected_thumbprint = NormalizeHex(ARIZONA_TAURI_CERT_SHA256);
    if (!IsConfigured(ARIZONA_TAURI_CERT_SHA256) || expected_thumbprint.empty()) {
#if ARIZONA_ALLOW_DEV_AEX_CLIENT
        return true;
#else
        error = "tauri_signature_publisher_pin_missing";
        return false;
#endif
    }

    std::string actual_thumbprint;
    if (!ReadSignerCertificateSha256(path, actual_thumbprint, error)) {
        return false;
    }

    if (NormalizeHex(actual_thumbprint) != expected_thumbprint) {
        error = "tauri_signature_publisher_mismatch";
        return false;
    }

    return true;
}

std::wstring FileNameFromPath(const std::wstring& path)
{
    const size_t slash_pos = path.find_last_of(L"\\/");
    if (slash_pos == std::wstring::npos) {
        return path;
    }

    return path.substr(slash_pos + 1);
}

bool WideEqualsIgnoreCase(const std::wstring& left, const wchar_t* right)
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

} // namespace

PipeSecurityAttributes::PipeSecurityAttributes()
    : attributes_(), descriptor_(nullptr)
{
    attributes_.nLength = sizeof(attributes_);
    attributes_.bInheritHandle = FALSE;
    attributes_.lpSecurityDescriptor = nullptr;

    PSECURITY_DESCRIPTOR descriptor = nullptr;
    if (ConvertStringSecurityDescriptorToSecurityDescriptorW(
            L"D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;OW)",
            SDDL_REVISION_1,
            &descriptor,
            nullptr)) {
        descriptor_ = descriptor;
        attributes_.lpSecurityDescriptor = descriptor_;
    }
}

PipeSecurityAttributes::~PipeSecurityAttributes()
{
    if (descriptor_) {
        LocalFree(descriptor_);
        descriptor_ = nullptr;
    }
}

SECURITY_ATTRIBUTES* PipeSecurityAttributes::get()
{
    return &attributes_;
}

bool IsAllowedPipeClient(
    HANDLE pipe,
    DWORD& client_pid,
    std::wstring& client_image_path,
    std::string& error)
{
    client_pid = 0;
    client_image_path.clear();
    error.clear();

    if (!GetNamedPipeClientProcessId(pipe, &client_pid) || client_pid == 0) {
        error = "pipe_client_pid_unavailable";
        return false;
    }

    HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, client_pid);
    if (!process) {
        error = "pipe_client_process_unavailable";
        return false;
    }

    wchar_t image_path[4096] = {};
    DWORD image_path_len = static_cast<DWORD>(sizeof(image_path) / sizeof(image_path[0]));
    const BOOL got_path = QueryFullProcessImageNameW(process, 0, image_path, &image_path_len);
    CloseHandle(process);

    if (!got_path || image_path_len == 0) {
        error = "pipe_client_image_unavailable";
        return false;
    }

    client_image_path.assign(image_path, image_path_len);

    if (VerifyAuthenticodeTrust(client_image_path, error)
        && IsExpectedPublisherCertificate(client_image_path, error)) {
        return true;
    }

#if ARIZONA_ALLOW_DEV_AEX_CLIENT
    const std::wstring file_name = FileNameFromPath(client_image_path);
    if (WideEqualsIgnoreCase(file_name, L"arizona-app.exe")) {
        error.clear();
        return true;
    }
#endif

    return false;
}
