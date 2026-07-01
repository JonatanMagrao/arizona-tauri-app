#pragma once

#include "../BridgeContext.h"

enum class MarkerPickDirection {
    Backward,
    Forward,
};

A_Err RunMoveLayersToMarkers(const BridgeContext& context);
A_Err RunMoveLayersToMarkers(const BridgeContext& context, MarkerPickDirection direction);
A_Err RunMoveSelectedJumpMarkers(const BridgeContext& context);
A_Err RunSelectLayersWithJumpMarkerAtCurrentTime(const BridgeContext& context);
A_Err RunAdjustTimelineMarkersToTail(const BridgeContext& context);
