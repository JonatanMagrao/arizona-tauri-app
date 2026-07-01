#include "BridgeProtocol.h"

#include <algorithm>
#include <bcrypt.h>
#include <cctype>
#include <ctime>
#include <limits>
#include <map>
#include <string>
#include <vector>

#ifndef ARIZONA_AEX_JWT_ES256_PUBLIC_X
#define ARIZONA_AEX_JWT_ES256_PUBLIC_X ""
#endif

#ifndef ARIZONA_AEX_JWT_ES256_PUBLIC_Y
#define ARIZONA_AEX_JWT_ES256_PUBLIC_Y ""
#endif

#ifndef ARIZONA_AEX_JWT_KID
#define ARIZONA_AEX_JWT_KID ""
#endif

#ifndef ARIZONA_ALLOW_DEV_AEX_TOKEN
#define ARIZONA_ALLOW_DEV_AEX_TOKEN 0
#endif

#ifndef NT_SUCCESS
#define NT_SUCCESS(Status) (((NTSTATUS)(Status)) >= 0)
#endif

namespace {

const char* kProtocolVersion = "arizona.aex.v1";
const size_t kMaxPayloadBytes = 16 * 1024;
const size_t kMaxIdBytes = 96;
const size_t kMaxCommandBytes = 64;
const size_t kMaxShowAlertMessageBytes = 512;
const std::int64_t kCommandMaxTtlSeconds = 60;
const std::int64_t kCommandFutureSkewSeconds = 30;
const std::int64_t kCommandExpiredSkewSeconds = 5;
const std::int64_t kJwtClockSkewSeconds = 30;

enum JsonKind {
    JsonNull,
    JsonBool,
    JsonString,
    JsonNumber,
    JsonObject,
    JsonArray
};

struct JsonValue {
    JsonKind kind = JsonNull;
    bool bool_value = false;
    std::string text;
    std::map<std::string, JsonValue> object;
    std::vector<JsonValue> array;
};

class JsonParser {
public:
    explicit JsonParser(const std::string& source)
        : source_(source), pos_(0)
    {
    }

    bool Parse(JsonValue& value, std::string& error)
    {
        SkipWhitespace();
        if (!ParseValue(value, 0, error)) {
            return false;
        }
        SkipWhitespace();
        if (pos_ != source_.size()) {
            error = "json_trailing_data";
            return false;
        }
        return true;
    }

private:
    bool ParseValue(JsonValue& value, int depth, std::string& error)
    {
        if (depth > 16) {
            error = "json_too_deep";
            return false;
        }

        SkipWhitespace();
        if (pos_ >= source_.size()) {
            error = "json_unexpected_end";
            return false;
        }

        const char ch = source_[pos_];
        if (ch == '{') {
            return ParseObject(value, depth, error);
        }
        if (ch == '[') {
            return ParseArray(value, depth, error);
        }
        if (ch == '"') {
            value = JsonValue();
            value.kind = JsonString;
            return ParseString(value.text, error);
        }
        if (ch == '-' || (ch >= '0' && ch <= '9')) {
            value = JsonValue();
            value.kind = JsonNumber;
            return ParseNumber(value.text, error);
        }
        if (ConsumeLiteral("true")) {
            value = JsonValue();
            value.kind = JsonBool;
            value.bool_value = true;
            return true;
        }
        if (ConsumeLiteral("false")) {
            value = JsonValue();
            value.kind = JsonBool;
            value.bool_value = false;
            return true;
        }
        if (ConsumeLiteral("null")) {
            value = JsonValue();
            value.kind = JsonNull;
            return true;
        }

        error = "json_invalid_value";
        return false;
    }

    bool ParseObject(JsonValue& value, int depth, std::string& error)
    {
        value = JsonValue();
        value.kind = JsonObject;
        ++pos_;
        SkipWhitespace();

        if (ConsumeChar('}')) {
            return true;
        }

        while (pos_ < source_.size()) {
            std::string key;
            if (!ParseString(key, error)) {
                return false;
            }

            SkipWhitespace();
            if (!ConsumeChar(':')) {
                error = "json_expected_colon";
                return false;
            }

            JsonValue member;
            if (!ParseValue(member, depth + 1, error)) {
                return false;
            }
            value.object[key] = member;

            SkipWhitespace();
            if (ConsumeChar('}')) {
                return true;
            }
            if (!ConsumeChar(',')) {
                error = "json_expected_comma";
                return false;
            }
            SkipWhitespace();
        }

        error = "json_unclosed_object";
        return false;
    }

    bool ParseArray(JsonValue& value, int depth, std::string& error)
    {
        value = JsonValue();
        value.kind = JsonArray;
        ++pos_;
        SkipWhitespace();

        if (ConsumeChar(']')) {
            return true;
        }

        while (pos_ < source_.size()) {
            JsonValue item;
            if (!ParseValue(item, depth + 1, error)) {
                return false;
            }
            value.array.push_back(item);

            SkipWhitespace();
            if (ConsumeChar(']')) {
                return true;
            }
            if (!ConsumeChar(',')) {
                error = "json_expected_array_comma";
                return false;
            }
            SkipWhitespace();
        }

        error = "json_unclosed_array";
        return false;
    }

    bool ParseString(std::string& value, std::string& error)
    {
        value.clear();
        if (!ConsumeChar('"')) {
            error = "json_expected_string";
            return false;
        }

        while (pos_ < source_.size()) {
            const char ch = source_[pos_++];
            if (ch == '"') {
                return true;
            }

            if (static_cast<unsigned char>(ch) < 0x20) {
                error = "json_invalid_control_char";
                return false;
            }

            if (ch != '\\') {
                value.push_back(ch);
                continue;
            }

            if (pos_ >= source_.size()) {
                error = "json_invalid_escape";
                return false;
            }

            const char escape = source_[pos_++];
            switch (escape) {
                case '"': value.push_back('"'); break;
                case '\\': value.push_back('\\'); break;
                case '/': value.push_back('/'); break;
                case 'b': value.push_back('\b'); break;
                case 'f': value.push_back('\f'); break;
                case 'n': value.push_back('\n'); break;
                case 'r': value.push_back('\r'); break;
                case 't': value.push_back('\t'); break;
                case 'u': {
                    unsigned int codepoint = 0;
                    if (!ParseHex4(codepoint)) {
                        error = "json_invalid_unicode_escape";
                        return false;
                    }

                    if (codepoint >= 0xD800 && codepoint <= 0xDBFF) {
                        const size_t saved_pos = pos_;
                        if (pos_ + 1 < source_.size() && source_[pos_] == '\\' && source_[pos_ + 1] == 'u') {
                            pos_ += 2;
                            unsigned int low = 0;
                            if (ParseHex4(low) && low >= 0xDC00 && low <= 0xDFFF) {
                                codepoint = 0x10000 + (((codepoint - 0xD800) << 10) | (low - 0xDC00));
                            } else {
                                pos_ = saved_pos;
                            }
                        }
                    }

                    AppendUtf8(codepoint, value);
                    break;
                }
                default:
                    error = "json_invalid_escape";
                    return false;
            }
        }

        error = "json_unclosed_string";
        return false;
    }

    bool ParseNumber(std::string& value, std::string& error)
    {
        const size_t start = pos_;
        if (source_[pos_] == '-') {
            ++pos_;
        }

        if (pos_ >= source_.size()) {
            error = "json_invalid_number";
            return false;
        }

        if (source_[pos_] == '0') {
            ++pos_;
        } else if (source_[pos_] >= '1' && source_[pos_] <= '9') {
            while (pos_ < source_.size() && source_[pos_] >= '0' && source_[pos_] <= '9') {
                ++pos_;
            }
        } else {
            error = "json_invalid_number";
            return false;
        }

        if (pos_ < source_.size() && source_[pos_] == '.') {
            ++pos_;
            if (pos_ >= source_.size() || source_[pos_] < '0' || source_[pos_] > '9') {
                error = "json_invalid_number";
                return false;
            }
            while (pos_ < source_.size() && source_[pos_] >= '0' && source_[pos_] <= '9') {
                ++pos_;
            }
        }

        if (pos_ < source_.size() && (source_[pos_] == 'e' || source_[pos_] == 'E')) {
            ++pos_;
            if (pos_ < source_.size() && (source_[pos_] == '+' || source_[pos_] == '-')) {
                ++pos_;
            }
            if (pos_ >= source_.size() || source_[pos_] < '0' || source_[pos_] > '9') {
                error = "json_invalid_number";
                return false;
            }
            while (pos_ < source_.size() && source_[pos_] >= '0' && source_[pos_] <= '9') {
                ++pos_;
            }
        }

        value = source_.substr(start, pos_ - start);
        return true;
    }

    bool ParseHex4(unsigned int& value)
    {
        if (pos_ + 4 > source_.size()) {
            return false;
        }

        value = 0;
        for (int count = 0; count < 4; ++count) {
            const char ch = source_[pos_++];
            unsigned int digit = 0;
            if (ch >= '0' && ch <= '9') {
                digit = static_cast<unsigned int>(ch - '0');
            } else if (ch >= 'a' && ch <= 'f') {
                digit = static_cast<unsigned int>(ch - 'a' + 10);
            } else if (ch >= 'A' && ch <= 'F') {
                digit = static_cast<unsigned int>(ch - 'A' + 10);
            } else {
                return false;
            }
            value = (value << 4) | digit;
        }

        return true;
    }

    void AppendUtf8(unsigned int codepoint, std::string& output)
    {
        if (codepoint <= 0x7F) {
            output.push_back(static_cast<char>(codepoint));
        } else if (codepoint <= 0x7FF) {
            output.push_back(static_cast<char>(0xC0 | ((codepoint >> 6) & 0x1F)));
            output.push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
        } else if (codepoint <= 0xFFFF) {
            output.push_back(static_cast<char>(0xE0 | ((codepoint >> 12) & 0x0F)));
            output.push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F)));
            output.push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
        } else {
            output.push_back(static_cast<char>(0xF0 | ((codepoint >> 18) & 0x07)));
            output.push_back(static_cast<char>(0x80 | ((codepoint >> 12) & 0x3F)));
            output.push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F)));
            output.push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
        }
    }

    void SkipWhitespace()
    {
        while (pos_ < source_.size()
            && std::isspace(static_cast<unsigned char>(source_[pos_]))) {
            ++pos_;
        }
    }

    bool ConsumeChar(char expected)
    {
        if (pos_ < source_.size() && source_[pos_] == expected) {
            ++pos_;
            return true;
        }
        return false;
    }

    bool ConsumeLiteral(const char* literal)
    {
        const size_t start = pos_;
        for (size_t index = 0; literal[index] != '\0'; ++index) {
            if (pos_ + index >= source_.size() || source_[pos_ + index] != literal[index]) {
                pos_ = start;
                return false;
            }
        }

        pos_ += std::char_traits<char>::length(literal);
        return true;
    }

    const std::string& source_;
    size_t pos_;
};

const JsonValue* ObjectField(const JsonValue& value, const char* key)
{
    if (value.kind != JsonObject) {
        return nullptr;
    }

    const std::map<std::string, JsonValue>::const_iterator found = value.object.find(key);
    if (found == value.object.end()) {
        return nullptr;
    }

    return &found->second;
}

bool JsonStringField(const JsonValue& object, const char* key, std::string& value)
{
    const JsonValue* field = ObjectField(object, key);
    if (!field || field->kind != JsonString) {
        return false;
    }

    value = field->text;
    return true;
}

bool JsonNumberToU64(const JsonValue& value, std::uint64_t& number)
{
    if (value.kind != JsonNumber || value.text.empty()) {
        return false;
    }

    std::uint64_t result = 0;
    for (char ch : value.text) {
        if (ch < '0' || ch > '9') {
            return false;
        }

        const std::uint64_t digit = static_cast<std::uint64_t>(ch - '0');
        if (result > ((std::numeric_limits<std::uint64_t>::max)() - digit) / 10) {
            return false;
        }
        result = (result * 10) + digit;
    }

    number = result;
    return true;
}

bool JsonNumberToI64(const JsonValue& value, std::int64_t& number)
{
    if (value.kind != JsonNumber || value.text.empty()) {
        return false;
    }

    size_t index = 0;
    bool negative = false;
    if (value.text[index] == '-') {
        negative = true;
        ++index;
    }

    if (index >= value.text.size()) {
        return false;
    }

    std::uint64_t result = 0;
    for (; index < value.text.size(); ++index) {
        const char ch = value.text[index];
        if (ch < '0' || ch > '9') {
            return false;
        }
        const std::uint64_t digit = static_cast<std::uint64_t>(ch - '0');
        if (result > ((std::numeric_limits<std::uint64_t>::max)() - digit) / 10) {
            return false;
        }
        result = (result * 10) + digit;
    }

    if (negative) {
        if (result > static_cast<std::uint64_t>((std::numeric_limits<std::int64_t>::max)()) + 1ULL) {
            return false;
        }
        number = result == static_cast<std::uint64_t>((std::numeric_limits<std::int64_t>::max)()) + 1ULL
            ? (std::numeric_limits<std::int64_t>::min)()
            : -static_cast<std::int64_t>(result);
    } else {
        if (result > static_cast<std::uint64_t>((std::numeric_limits<std::int64_t>::max)())) {
            return false;
        }
        number = static_cast<std::int64_t>(result);
    }

    return true;
}

bool Base64UrlDecode(const std::string& input, std::vector<unsigned char>& output)
{
    output.clear();
    unsigned int accumulator = 0;
    int bits = 0;

    for (char ch : input) {
        if (ch == '=') {
            break;
        }

        int value = -1;
        if (ch >= 'A' && ch <= 'Z') {
            value = ch - 'A';
        } else if (ch >= 'a' && ch <= 'z') {
            value = ch - 'a' + 26;
        } else if (ch >= '0' && ch <= '9') {
            value = ch - '0' + 52;
        } else if (ch == '-') {
            value = 62;
        } else if (ch == '_') {
            value = 63;
        } else {
            return false;
        }

        accumulator = (accumulator << 6) | static_cast<unsigned int>(value);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            output.push_back(static_cast<unsigned char>((accumulator >> bits) & 0xFF));
        }
    }

    return true;
}

bool Base64UrlDecodeString(const std::string& input, std::string& output)
{
    std::vector<unsigned char> bytes;
    if (!Base64UrlDecode(input, bytes)) {
        return false;
    }

    output.assign(reinterpret_cast<const char*>(bytes.data()), bytes.size());
    return true;
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

bool HexToBytes(const std::string& hex, std::vector<unsigned char>& bytes)
{
    const std::string normalized = NormalizeHex(hex);
    if (normalized.empty() || (normalized.size() % 2) != 0) {
        return false;
    }

    bytes.clear();
    bytes.reserve(normalized.size() / 2);

    for (size_t index = 0; index < normalized.size(); index += 2) {
        unsigned char byte = 0;
        for (size_t nibble = 0; nibble < 2; ++nibble) {
            const char ch = normalized[index + nibble];
            unsigned char value = 0;
            if (ch >= '0' && ch <= '9') {
                value = static_cast<unsigned char>(ch - '0');
            } else if (ch >= 'A' && ch <= 'F') {
                value = static_cast<unsigned char>(ch - 'A' + 10);
            } else {
                return false;
            }
            byte = static_cast<unsigned char>((byte << 4) | value);
        }
        bytes.push_back(byte);
    }

    return true;
}

bool Sha256(const std::string& input, std::vector<unsigned char>& digest)
{
    BCRYPT_ALG_HANDLE algorithm = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
    std::vector<unsigned char> hash_object;
    bool ok = false;

    do {
        if (!NT_SUCCESS(BCryptOpenAlgorithmProvider(
                &algorithm,
                BCRYPT_SHA256_ALGORITHM,
                nullptr,
                0))) {
            break;
        }

        DWORD object_length = 0;
        DWORD hash_length = 0;
        DWORD result_length = 0;

        if (!NT_SUCCESS(BCryptGetProperty(
                algorithm,
                BCRYPT_OBJECT_LENGTH,
                reinterpret_cast<PUCHAR>(&object_length),
                sizeof(object_length),
                &result_length,
                0))) {
            break;
        }

        if (!NT_SUCCESS(BCryptGetProperty(
                algorithm,
                BCRYPT_HASH_LENGTH,
                reinterpret_cast<PUCHAR>(&hash_length),
                sizeof(hash_length),
                &result_length,
                0))) {
            break;
        }

        hash_object.resize(object_length);
        digest.assign(hash_length, 0);

        if (!NT_SUCCESS(BCryptCreateHash(
                algorithm,
                &hash,
                hash_object.data(),
                static_cast<ULONG>(hash_object.size()),
                nullptr,
                0,
                0))) {
            break;
        }

        if (!NT_SUCCESS(BCryptHashData(
                hash,
                reinterpret_cast<PUCHAR>(const_cast<char*>(input.data())),
                static_cast<ULONG>(input.size()),
                0))) {
            break;
        }

        if (!NT_SUCCESS(BCryptFinishHash(
                hash,
                digest.data(),
                static_cast<ULONG>(digest.size()),
                0))) {
            break;
        }

        ok = true;
    } while (false);

    if (hash) {
        BCryptDestroyHash(hash);
    }
    if (algorithm) {
        BCryptCloseAlgorithmProvider(algorithm, 0);
    }

    return ok;
}

bool VerifyEs256Signature(
    const std::string& signing_input,
    const std::vector<unsigned char>& signature)
{
    if (signature.size() != 64) {
        return false;
    }

    std::vector<unsigned char> public_x;
    std::vector<unsigned char> public_y;
    if (!HexToBytes(ARIZONA_AEX_JWT_ES256_PUBLIC_X, public_x)
        || !HexToBytes(ARIZONA_AEX_JWT_ES256_PUBLIC_Y, public_y)
        || public_x.size() != 32
        || public_y.size() != 32) {
        return false;
    }

    std::vector<unsigned char> digest;
    if (!Sha256(signing_input, digest)) {
        return false;
    }

    BCRYPT_ALG_HANDLE algorithm = nullptr;
    BCRYPT_KEY_HANDLE key = nullptr;
    bool ok = false;

    do {
        if (!NT_SUCCESS(BCryptOpenAlgorithmProvider(
                &algorithm,
                BCRYPT_ECDSA_P256_ALGORITHM,
                nullptr,
                0))) {
            break;
        }

        std::vector<unsigned char> key_blob(sizeof(BCRYPT_ECCKEY_BLOB) + 64);
        BCRYPT_ECCKEY_BLOB* header =
            reinterpret_cast<BCRYPT_ECCKEY_BLOB*>(key_blob.data());
        header->dwMagic = BCRYPT_ECDSA_PUBLIC_P256_MAGIC;
        header->cbKey = 32;
        std::copy(public_x.begin(), public_x.end(), key_blob.begin() + sizeof(BCRYPT_ECCKEY_BLOB));
        std::copy(public_y.begin(), public_y.end(), key_blob.begin() + sizeof(BCRYPT_ECCKEY_BLOB) + 32);

        if (!NT_SUCCESS(BCryptImportKeyPair(
                algorithm,
                nullptr,
                BCRYPT_ECCPUBLIC_BLOB,
                &key,
                key_blob.data(),
                static_cast<ULONG>(key_blob.size()),
                0))) {
            break;
        }

        ok = NT_SUCCESS(BCryptVerifySignature(
            key,
            nullptr,
            digest.data(),
            static_cast<ULONG>(digest.size()),
            const_cast<PUCHAR>(signature.data()),
            static_cast<ULONG>(signature.size()),
            0));
    } while (false);

    if (key) {
        BCryptDestroyKey(key);
    }
    if (algorithm) {
        BCryptCloseAlgorithmProvider(algorithm, 0);
    }

    return ok;
}

bool ParseJsonObject(const std::string& json, JsonValue& object, std::string& error)
{
    JsonParser parser(json);
    if (!parser.Parse(object, error)) {
        return false;
    }
    if (object.kind != JsonObject) {
        error = "json_root_not_object";
        return false;
    }
    return true;
}

bool SplitJwt(
    const std::string& token,
    std::string& header_b64,
    std::string& claims_b64,
    std::string& signature_b64)
{
    const size_t first_dot = token.find('.');
    if (first_dot == std::string::npos) {
        return false;
    }

    const size_t second_dot = token.find('.', first_dot + 1);
    if (second_dot == std::string::npos || token.find('.', second_dot + 1) != std::string::npos) {
        return false;
    }

    header_b64 = token.substr(0, first_dot);
    claims_b64 = token.substr(first_dot + 1, second_dot - first_dot - 1);
    signature_b64 = token.substr(second_dot + 1);
    return !header_b64.empty() && !claims_b64.empty() && !signature_b64.empty();
}

bool StringArrayContains(const JsonValue& value, const char* expected)
{
    if (value.kind != JsonArray) {
        return false;
    }

    for (const JsonValue& item : value.array) {
        if (item.kind == JsonString && item.text == expected) {
            return true;
        }
    }

    return false;
}

bool ClaimMatchesStringOrArray(const JsonValue& claims, const char* key, const char* expected)
{
    const JsonValue* field = ObjectField(claims, key);
    if (!field) {
        return false;
    }

    if (field->kind == JsonString) {
        return field->text == expected;
    }

    return StringArrayContains(*field, expected);
}

bool ValidateBridgeTokenClaims(const JsonValue& claims, std::string& error)
{
    std::string issuer;
    if (!JsonStringField(claims, "iss", issuer) || issuer != "arizona-app") {
        error = "bridge_token_issuer_invalid";
        return false;
    }

    if (!ClaimMatchesStringOrArray(claims, "aud", "arizona-aex-bridge")) {
        error = "bridge_token_audience_invalid";
        return false;
    }

    if (!ClaimMatchesStringOrArray(claims, "feature", "ae_bridge")
        && !ClaimMatchesStringOrArray(claims, "features", "ae_bridge")) {
        error = "bridge_token_feature_missing";
        return false;
    }

    const std::int64_t now = static_cast<std::int64_t>(std::time(nullptr));
    const JsonValue* exp = ObjectField(claims, "exp");
    std::int64_t exp_value = 0;
    if (!exp || !JsonNumberToI64(*exp, exp_value) || exp_value < now - kJwtClockSkewSeconds) {
        error = "bridge_token_expired";
        return false;
    }

    const JsonValue* nbf = ObjectField(claims, "nbf");
    std::int64_t nbf_value = 0;
    if (nbf && (!JsonNumberToI64(*nbf, nbf_value) || nbf_value > now + kJwtClockSkewSeconds)) {
        error = "bridge_token_not_yet_valid";
        return false;
    }

    const JsonValue* iat = ObjectField(claims, "iat");
    std::int64_t iat_value = 0;
    if (iat && (!JsonNumberToI64(*iat, iat_value) || iat_value > now + kJwtClockSkewSeconds)) {
        error = "bridge_token_iat_invalid";
        return false;
    }

    const JsonValue* jti = ObjectField(claims, "jti");
    if (jti && (jti->kind != JsonString || jti->text.size() > 128)) {
        error = "bridge_token_jti_invalid";
        return false;
    }

    return true;
}

bool ValidateBridgeToken(const std::string& token, std::string& error)
{
#if ARIZONA_ALLOW_DEV_AEX_TOKEN
    if (token == "arizona-aex-dev-token") {
        return true;
    }
#endif

    if (token.size() > 4096) {
        error = "bridge_token_too_large";
        return false;
    }

    std::string header_b64;
    std::string claims_b64;
    std::string signature_b64;
    if (!SplitJwt(token, header_b64, claims_b64, signature_b64)) {
        error = "bridge_token_malformed";
        return false;
    }

    std::string header_json;
    std::string claims_json;
    std::vector<unsigned char> signature;
    if (!Base64UrlDecodeString(header_b64, header_json)
        || !Base64UrlDecodeString(claims_b64, claims_json)
        || !Base64UrlDecode(signature_b64, signature)) {
        error = "bridge_token_base64_invalid";
        return false;
    }

    JsonValue header;
    JsonValue claims;
    if (!ParseJsonObject(header_json, header, error)) {
        error = "bridge_token_header_invalid";
        return false;
    }
    if (!ParseJsonObject(claims_json, claims, error)) {
        error = "bridge_token_claims_invalid";
        return false;
    }

    std::string algorithm;
    if (!JsonStringField(header, "alg", algorithm) || algorithm != "ES256") {
        error = "bridge_token_alg_invalid";
        return false;
    }

    const std::string expected_kid = ARIZONA_AEX_JWT_KID;
    if (!expected_kid.empty()) {
        std::string kid;
        if (!JsonStringField(header, "kid", kid) || kid != expected_kid) {
            error = "bridge_token_kid_invalid";
            return false;
        }
    }

    if (!VerifyEs256Signature(header_b64 + "." + claims_b64, signature)) {
        error = "bridge_token_signature_invalid";
        return false;
    }

    return ValidateBridgeTokenClaims(claims, error);
}

bool Parse2Digits(const std::string& text, size_t pos, WORD& value)
{
    if (pos + 2 > text.size()
        || !std::isdigit(static_cast<unsigned char>(text[pos]))
        || !std::isdigit(static_cast<unsigned char>(text[pos + 1]))) {
        return false;
    }

    value = static_cast<WORD>(((text[pos] - '0') * 10) + (text[pos + 1] - '0'));
    return true;
}

bool Parse4Digits(const std::string& text, size_t pos, WORD& value)
{
    if (pos + 4 > text.size()) {
        return false;
    }

    WORD result = 0;
    for (size_t index = 0; index < 4; ++index) {
        const char ch = text[pos + index];
        if (!std::isdigit(static_cast<unsigned char>(ch))) {
            return false;
        }
        result = static_cast<WORD>((result * 10) + (ch - '0'));
    }

    value = result;
    return true;
}

bool ParseUtcTimestampToEpochSeconds(const std::string& text, std::int64_t& epoch_seconds)
{
    if (text.size() < 20
        || text[4] != '-'
        || text[7] != '-'
        || text[10] != 'T'
        || text[13] != ':'
        || text[16] != ':') {
        return false;
    }

    SYSTEMTIME system_time = {};
    if (!Parse4Digits(text, 0, system_time.wYear)
        || !Parse2Digits(text, 5, system_time.wMonth)
        || !Parse2Digits(text, 8, system_time.wDay)
        || !Parse2Digits(text, 11, system_time.wHour)
        || !Parse2Digits(text, 14, system_time.wMinute)
        || !Parse2Digits(text, 17, system_time.wSecond)) {
        return false;
    }

    size_t timezone_pos = 19;
    if (timezone_pos < text.size() && text[timezone_pos] == '.') {
        ++timezone_pos;
        while (timezone_pos < text.size()
            && std::isdigit(static_cast<unsigned char>(text[timezone_pos]))) {
            ++timezone_pos;
        }
    }

    if (timezone_pos >= text.size() || text[timezone_pos] != 'Z' || timezone_pos + 1 != text.size()) {
        return false;
    }

    FILETIME file_time = {};
    if (!SystemTimeToFileTime(&system_time, &file_time)) {
        return false;
    }

    ULARGE_INTEGER file_time_value = {};
    file_time_value.LowPart = file_time.dwLowDateTime;
    file_time_value.HighPart = file_time.dwHighDateTime;
    const unsigned long long unix_epoch_file_time = 116444736000000000ULL;
    if (file_time_value.QuadPart < unix_epoch_file_time) {
        return false;
    }

    epoch_seconds = static_cast<std::int64_t>(
        (file_time_value.QuadPart - unix_epoch_file_time) / 10000000ULL);
    return true;
}

bool IsAllowedCommand(const std::string& command)
{
    return command == "show_alert"
        || command == "move_layers_backward"
        || command == "move_layers_forward"
        || command == "move_layers_to_markers"
        || command == "move_jump_marker"
        || command == "select_jump_marker_layer"
        || command == "adjust_markers_to_tail";
}

bool ValidateCommandArgs(
    const JsonValue& root,
    BridgeCommandEnvelope& command,
    std::string& error)
{
    const JsonValue* args = ObjectField(root, "args");
    if (command.command == "show_alert") {
        command.show_alert_message = "ponte feita";
        if (!args || args->kind == JsonNull) {
            return true;
        }
        if (args->kind != JsonObject) {
            error = "command_args_invalid";
            return false;
        }

        const JsonValue* message = ObjectField(*args, "message");
        if (!message) {
            return true;
        }
        if (message->kind != JsonString || message->text.size() > kMaxShowAlertMessageBytes) {
            error = "command_message_invalid";
            return false;
        }
        command.show_alert_message = message->text.empty() ? "ponte feita" : message->text;
        return true;
    }

    if (args && args->kind != JsonNull) {
        error = "command_args_unexpected";
        return false;
    }

    return true;
}

bool ValidateCommandTimes(const JsonValue& root, std::string& error)
{
    std::string issued_at;
    std::string expires_at;
    if (!JsonStringField(root, "issuedAt", issued_at)
        || !JsonStringField(root, "expiresAt", expires_at)) {
        error = "command_time_missing";
        return false;
    }

    std::int64_t issued_epoch = 0;
    std::int64_t expires_epoch = 0;
    if (!ParseUtcTimestampToEpochSeconds(issued_at, issued_epoch)
        || !ParseUtcTimestampToEpochSeconds(expires_at, expires_epoch)) {
        error = "command_time_invalid";
        return false;
    }

    const std::int64_t now = static_cast<std::int64_t>(std::time(nullptr));
    if (issued_epoch > now + kCommandFutureSkewSeconds) {
        error = "command_issued_in_future";
        return false;
    }
    if (expires_epoch < now - kCommandExpiredSkewSeconds) {
        error = "command_expired";
        return false;
    }
    if (expires_epoch <= issued_epoch || expires_epoch - issued_epoch > kCommandMaxTtlSeconds) {
        error = "command_ttl_invalid";
        return false;
    }

    return true;
}

} // namespace

bool TryValidateBridgeCommand(
    const std::string& payload,
    DWORD client_pid,
    BridgeProtocolState& state,
    BridgeCommandEnvelope& command,
    std::string& error)
{
    command = BridgeCommandEnvelope();
    error.clear();

    if (payload.empty() || payload.size() > kMaxPayloadBytes) {
        error = "payload_size_invalid";
        return false;
    }

    JsonValue root;
    if (!ParseJsonObject(payload, root, error)) {
        return false;
    }

    std::string type;
    std::string protocol_version;
    std::string bridge_token;
    if (!JsonStringField(root, "type", type) || type != "ae.command") {
        error = "message_type_invalid";
        return false;
    }
    if (!JsonStringField(root, "protocolVersion", protocol_version)
        || protocol_version != kProtocolVersion) {
        error = "protocol_version_invalid";
        return false;
    }
    if (!JsonStringField(root, "id", command.id)
        || command.id.empty()
        || command.id.size() > kMaxIdBytes) {
        error = "command_id_invalid";
        return false;
    }

    const JsonValue* seq = ObjectField(root, "seq");
    if (!seq || !JsonNumberToU64(*seq, command.seq) || command.seq == 0) {
        error = "command_seq_invalid";
        return false;
    }

    if (!JsonStringField(root, "command", command.command)
        || command.command.empty()
        || command.command.size() > kMaxCommandBytes
        || !IsAllowedCommand(command.command)) {
        error = "command_not_allowed";
        return false;
    }

    if (!JsonStringField(root, "bridgeToken", bridge_token) || bridge_token.empty()) {
        error = "bridge_token_missing";
        return false;
    }

    if (!ValidateCommandTimes(root, error)) {
        return false;
    }

    if (!ValidateCommandArgs(root, command, error)) {
        return false;
    }

    const std::uint64_t last_seq = state.client_pid == client_pid ? state.last_seq : 0;
    if (command.seq <= last_seq) {
        error = "command_replay";
        return false;
    }

    if (!ValidateBridgeToken(bridge_token, error)) {
        return false;
    }

    state.client_pid = client_pid;
    state.last_seq = command.seq;
    return true;
}
