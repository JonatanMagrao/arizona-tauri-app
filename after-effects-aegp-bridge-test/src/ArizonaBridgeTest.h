#pragma once

#include "AEConfig.h"

#ifdef AE_OS_WIN
#include <windows.h>
#endif

#include "entry.h"
#include "AE_GeneralPlug.h"
#include "AE_Macros.h"
#include "AEGP_SuiteHandler.h"

extern "C" DllExport AEGP_PluginInitFuncPrototype EntryPointFunc;

