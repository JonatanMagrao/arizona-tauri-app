#include "ShowAlert.h"

static std::string JsStringLiteral(const std::string& value)
{
    std::string escaped = "\"";
    for (const char ch : value) {
        switch (ch) {
            case '\\': escaped += "\\\\"; break;
            case '"': escaped += "\\\""; break;
            case '\n': escaped += "\\n"; break;
            case '\r': escaped += "\\r"; break;
            case '\t': escaped += "\\t"; break;
            default: escaped.push_back(ch); break;
        }
    }
    escaped += "\"";
    return escaped;
}

A_Err RunShowAlert(const BridgeContext& context, const std::string& message)
{
    A_Err err = A_Err_NONE;
    A_Err err2 = A_Err_NONE;
    AEGP_SuiteHandler suites(context.sp);

    AEGP_MemHandle resultH = nullptr;
    AEGP_MemHandle errorH = nullptr;
    const std::string script = "alert(" + JsStringLiteral(message) + ");";

    ERR(suites.UtilitySuite6()->AEGP_ExecuteScript(
        context.plugin_id,
        script.c_str(),
        TRUE,
        &resultH,
        &errorH));

    if (resultH) {
        ERR2(suites.MemorySuite1()->AEGP_FreeMemHandle(resultH));
    }

    if (errorH) {
        ERR2(suites.MemorySuite1()->AEGP_FreeMemHandle(errorH));
    }

    return err;
}
