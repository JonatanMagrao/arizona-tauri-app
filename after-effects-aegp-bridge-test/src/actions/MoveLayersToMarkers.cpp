#include "MoveLayersToMarkers.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <string>
#include <vector>

namespace {

long double ToSeconds(const A_Time& time)
{
    if (time.scale == 0) {
        return 0.0L;
    }
    return static_cast<long double>(time.value) / static_cast<long double>(time.scale);
}

bool TimesNear(const A_Time& a, const A_Time& b, const A_Time& epsilon)
{
    return std::fabs(ToSeconds(a) - ToSeconds(b)) <= ToSeconds(epsilon);
}

bool TimeBefore(const A_Time& a, const A_Time& b)
{
    return ToSeconds(a) < ToSeconds(b);
}

bool AddFramesToTime(const A_Time& time, const A_Time& frame_duration, A_long frame_count, A_Time& result)
{
    if (frame_duration.scale == 0) {
        return false;
    }

    const long double target_seconds =
        ToSeconds(time) + (ToSeconds(frame_duration) * static_cast<long double>(frame_count));
    result.scale = frame_duration.scale;
    result.value = static_cast<A_long>(std::llround(target_seconds * result.scale));
    return true;
}

A_Time TimeFromSeconds(long double seconds, A_u_long scale)
{
    A_Time result;
    AEFX_CLR_STRUCT(result);
    result.scale = scale == 0 ? 1 : scale;
    result.value = static_cast<A_long>(std::llround(seconds * result.scale));
    return result;
}

A_Time ClampTimeToComp(const A_Time& time, const A_Time& comp_duration)
{
    const long double duration_seconds =
        ToSeconds(comp_duration) < 0.0L ? 0.0L : ToSeconds(comp_duration);
    long double seconds = ToSeconds(time);
    if (seconds < 0.0L) {
        seconds = 0.0L;
    }
    if (seconds > duration_seconds) {
        seconds = duration_seconds;
    }
    return TimeFromSeconds(seconds, comp_duration.scale);
}

A_Time TailMarkerTime(const A_Time& comp_duration, const A_Time& frame_duration, A_long marker_index)
{
    long double last_frame_seconds = ToSeconds(comp_duration) - ToSeconds(frame_duration);
    if (last_frame_seconds < 0.0L) {
        last_frame_seconds = 0.0L;
    }
    const long double seconds_from_end = static_cast<long double>(6 - marker_index);
    long double target_seconds = last_frame_seconds - seconds_from_end;
    if (target_seconds < 0.0L) {
        target_seconds = 0.0L;
    }
    return TimeFromSeconds(target_seconds, comp_duration.scale);
}

bool LabelToMarkerIndex(AEGP_LabelID label, A_long& marker_index)
{
    switch (label) {
        case 1: marker_index = 1; return true;
        case 2: marker_index = 2; return true;
        case 8: marker_index = 3; return true;
        case 9: marker_index = 4; return true;
        case 10: marker_index = 5; return true;
        case 11: marker_index = 6; return true;
        default: return false;
    }
}

A_Time HalfTime(const A_Time& time)
{
    A_Time result = time;
    result.scale *= 2;
    return result;
}

bool ContainsLayer(const std::vector<AEGP_LayerH>& layers, AEGP_LayerH layer)
{
    return std::find(layers.begin(), layers.end(), layer) != layers.end();
}

bool ContainsOfertaIndex(const std::string& text)
{
    const std::string prefix = "oferta_";
    size_t offset = 0;

    while (offset < text.size()) {
        const size_t position = text.find(prefix, offset);
        if (position == std::string::npos) {
            return false;
        }

        const size_t digit_position = position + prefix.size();
        if (digit_position < text.size()
            && std::isdigit(static_cast<unsigned char>(text[digit_position]))) {
            return true;
        }

        offset = position + 1;
    }

    return false;
}

bool ContainsPulo(const std::string& text)
{
    return text.find("pulo") != std::string::npos;
}

A_Err MemHandleToLowerAscii(AEGP_SuiteHandler& suites, AEGP_MemHandle memH, std::string& text)
{
    A_Err err = A_Err_NONE;
    A_Err err2 = A_Err_NONE;
    void* raw_memory = nullptr;
    AEGP_MemSize size = 0;
    bool locked = false;
    text.clear();

    if (!memH) {
        return err;
    }

    ERR(suites.MemorySuite1()->AEGP_GetMemHandleSize(memH, &size));
    ERR(suites.MemorySuite1()->AEGP_LockMemHandle(memH, &raw_memory));
    if (!err) {
        locked = true;
    }

    if (!err && raw_memory) {
        const A_u_short* chars = static_cast<const A_u_short*>(raw_memory);
        const size_t char_count = static_cast<size_t>(size / sizeof(A_u_short));

        for (size_t index = 0; index < char_count && chars[index] != 0; ++index) {
            const A_u_short ch = chars[index];
            if (ch <= 0x7f) {
                text.push_back(static_cast<char>(
                    std::tolower(static_cast<unsigned char>(ch))));
            }
        }
    }

    if (locked) {
        ERR2(suites.MemorySuite1()->AEGP_UnlockMemHandle(memH));
    }

    return err;
}

A_Err LayerMatchesOfertaIndex(
    const BridgeContext& context,
    AEGP_SuiteHandler& suites,
    AEGP_LayerH layerH,
    bool& matches)
{
    A_Err err = A_Err_NONE;
    A_Err err2 = A_Err_NONE;
    AEGP_MemHandle layer_nameH = nullptr;
    AEGP_MemHandle source_nameH = nullptr;
    std::string layer_name;
    std::string source_name;
    matches = false;

    ERR(suites.LayerSuite9()->AEGP_GetLayerName(
        context.plugin_id,
        layerH,
        &layer_nameH,
        &source_nameH));

    if (!err) {
        ERR(MemHandleToLowerAscii(suites, layer_nameH, layer_name));
    }
    if (!err) {
        ERR(MemHandleToLowerAscii(suites, source_nameH, source_name));
    }

    if (!err) {
        matches = ContainsOfertaIndex(layer_name) || ContainsOfertaIndex(source_name);
    }

    if (layer_nameH) {
        ERR2(suites.MemorySuite1()->AEGP_FreeMemHandle(layer_nameH));
    }
    if (source_nameH) {
        ERR2(suites.MemorySuite1()->AEGP_FreeMemHandle(source_nameH));
    }

    return err;
}

A_Err GetItemNameLower(
    const BridgeContext& context,
    AEGP_SuiteHandler& suites,
    AEGP_ItemH itemH,
    std::string& name)
{
    A_Err err = A_Err_NONE;
    A_Err err2 = A_Err_NONE;
    AEGP_MemHandle nameH = nullptr;
    name.clear();

    ERR(suites.ItemSuite9()->AEGP_GetItemName(context.plugin_id, itemH, &nameH));
    if (!err) {
        ERR(MemHandleToLowerAscii(suites, nameH, name));
    }

    if (nameH) {
        ERR2(suites.MemorySuite1()->AEGP_FreeMemHandle(nameH));
    }

    return err;
}

A_Err FindTimelineComp(
    const BridgeContext& context,
    AEGP_SuiteHandler& suites,
    AEGP_CompH& compH,
    AEGP_ItemH& itemH)
{
    A_Err err = A_Err_NONE;
    AEGP_ProjectH projectH = nullptr;
    AEGP_ItemH current_itemH = nullptr;
    compH = nullptr;
    itemH = nullptr;

    ERR(suites.ProjSuite6()->AEGP_GetProjectByIndex(0, &projectH));
    ERR(suites.ItemSuite9()->AEGP_GetFirstProjItem(projectH, &current_itemH));

    while (!err && current_itemH) {
        AEGP_ItemType item_type = AEGP_ItemType_NONE;
        std::string item_name;

        ERR(suites.ItemSuite9()->AEGP_GetItemType(current_itemH, &item_type));
        if (!err && item_type == AEGP_ItemType_COMP) {
            ERR(GetItemNameLower(context, suites, current_itemH, item_name));
            if (!err && item_name == "miolo") {
                itemH = current_itemH;
                ERR(suites.CompSuite12()->AEGP_GetCompFromItem(current_itemH, &compH));
                return err;
            }
        }

        AEGP_ItemH next_itemH = nullptr;
        ERR(suites.ItemSuite9()->AEGP_GetNextProjItem(projectH, current_itemH, &next_itemH));
        current_itemH = next_itemH;
    }

    return compH ? err : A_Err_GENERIC;
}

A_Err GetActiveComp(AEGP_SuiteHandler& suites, AEGP_CompH& compH)
{
    A_Err err = A_Err_NONE;
    AEGP_ItemH itemH = nullptr;
    AEGP_ItemType item_type = AEGP_ItemType_NONE;

    ERR(suites.ItemSuite9()->AEGP_GetActiveItem(&itemH));
    if (!err && !itemH) {
        return A_Err_GENERIC;
    }

    ERR(suites.ItemSuite9()->AEGP_GetItemType(itemH, &item_type));
    if (!err && item_type != AEGP_ItemType_COMP) {
        return A_Err_GENERIC;
    }

    ERR(suites.CompSuite12()->AEGP_GetCompFromItem(itemH, &compH));
    return err;
}

A_Err GetSelectedLayers(
    const BridgeContext& context,
    AEGP_SuiteHandler& suites,
    AEGP_CompH compH,
    std::vector<AEGP_LayerH>& selected_layers)
{
    A_Err err = A_Err_NONE;
    A_Err err2 = A_Err_NONE;
    AEGP_Collection2H collectionH = nullptr;

    ERR(suites.CompSuite12()->AEGP_GetNewCollectionFromCompSelection(
        context.plugin_id,
        compH,
        &collectionH));

    if (!err && collectionH) {
        A_u_long item_count = 0;
        ERR(suites.CollectionSuite2()->AEGP_GetCollectionNumItems(collectionH, &item_count));

        for (A_u_long index = 0; !err && index < item_count; ++index) {
            AEGP_CollectionItemV2 item;
            AEFX_CLR_STRUCT(item);
            ERR(suites.CollectionSuite2()->AEGP_GetCollectionItemByIndex(collectionH, index, &item));
            if (!err && item.type == AEGP_CollectionItemType_LAYER && item.u.layer.layerH) {
                if (!ContainsLayer(selected_layers, item.u.layer.layerH)) {
                    selected_layers.push_back(item.u.layer.layerH);
                }
            }
        }
    }

    if (collectionH) {
        ERR2(suites.CollectionSuite2()->AEGP_DisposeCollection(collectionH));
    }

    return err;
}

A_Err SetSelectedLayers(
    const BridgeContext& context,
    AEGP_SuiteHandler& suites,
    AEGP_CompH compH,
    const std::vector<AEGP_LayerH>& selected_layers)
{
    A_Err err = A_Err_NONE;
    A_Err err2 = A_Err_NONE;
    AEGP_Collection2H collectionH = nullptr;

    ERR(suites.CollectionSuite2()->AEGP_NewCollection(context.plugin_id, &collectionH));

    for (AEGP_LayerH layerH : selected_layers) {
        if (err || !layerH) {
            break;
        }

        AEGP_CollectionItemV2 item;
        AEFX_CLR_STRUCT(item);
        item.type = AEGP_CollectionItemType_LAYER;
        item.u.layer.layerH = layerH;
        ERR(suites.CollectionSuite2()->AEGP_CollectionPushBack(collectionH, &item));
    }

    ERR(suites.CompSuite12()->AEGP_SetSelection(compH, collectionH));

    if (collectionH) {
        ERR2(suites.CollectionSuite2()->AEGP_DisposeCollection(collectionH));
    }

    return err;
}

A_Err GetLayerMarkerStream(
    const BridgeContext& context,
    AEGP_SuiteHandler& suites,
    AEGP_LayerH layerH,
    AEGP_StreamRefH& streamH)
{
    return suites.StreamSuite6()->AEGP_GetNewLayerStream(
        context.plugin_id,
        layerH,
        AEGP_LayerStream_MARKER,
        &streamH);
}

A_Err MoveKeyframeToTime(
    const BridgeContext& context,
    AEGP_SuiteHandler& suites,
    AEGP_StreamRefH streamH,
    AEGP_KeyframeIndex key_index,
    const A_Time& target_time,
    const A_Time& epsilon,
    bool& moved)
{
    A_Err err = A_Err_NONE;
    A_Err err2 = A_Err_NONE;
    A_Time key_time;
    AEFX_CLR_STRUCT(key_time);
    AEGP_StreamValue2 value;
    AEFX_CLR_STRUCT(value);
    bool value_created = false;

    ERR(suites.KeyframeSuite5()->AEGP_GetKeyframeTime(
        streamH,
        key_index,
        AEGP_LTimeMode_CompTime,
        &key_time));

    if (!err && TimesNear(key_time, target_time, epsilon)) {
        return err;
    }

    ERR(suites.KeyframeSuite5()->AEGP_GetNewKeyframeValue(
        context.plugin_id,
        streamH,
        key_index,
        &value));
    if (!err) {
        value_created = true;
    }

    ERR(suites.KeyframeSuite5()->AEGP_DeleteKeyframe(streamH, key_index));

    if (!err) {
        AEGP_KeyframeIndex new_key_index = 0;
        ERR(suites.KeyframeSuite5()->AEGP_InsertKeyframe(
            streamH,
            AEGP_LTimeMode_CompTime,
            &target_time,
            &new_key_index));

        ERR(suites.KeyframeSuite5()->AEGP_SetKeyframeValue(
            streamH,
            new_key_index,
            &value));
    }

    if (value_created) {
        ERR2(suites.StreamSuite6()->AEGP_DisposeStreamValue(&value));
    }

    if (!err) {
        moved = true;
    }

    return err;
}

A_Err MoveLayerSecondMarkerToTime(
    const BridgeContext& context,
    AEGP_SuiteHandler& suites,
    AEGP_LayerH layerH,
    const A_Time& time,
    const A_Time& frame_duration,
    const A_Time& epsilon)
{
    A_Err err = A_Err_NONE;
    A_Err err2 = A_Err_NONE;
    AEGP_StreamRefH marker_streamH = nullptr;
    A_long key_count = 0;
    A_Time in_point;
    A_Time minimum_jump_time;
    A_Time target_time = time;
    bool moved = false;
    AEFX_CLR_STRUCT(in_point);
    AEFX_CLR_STRUCT(minimum_jump_time);

    ERR(GetLayerMarkerStream(context, suites, layerH, marker_streamH));
    ERR(suites.KeyframeSuite5()->AEGP_GetStreamNumKFs(marker_streamH, &key_count));

    if (!err && key_count >= 2) {
        ERR(suites.LayerSuite9()->AEGP_GetLayerInPoint(
            layerH,
            AEGP_LTimeMode_CompTime,
            &in_point));

        if (!err && AddFramesToTime(in_point, frame_duration, 27, minimum_jump_time)
            && TimeBefore(target_time, minimum_jump_time)) {
            target_time = minimum_jump_time;
        }

        ERR(MoveKeyframeToTime(context, suites, marker_streamH, 1, target_time, epsilon, moved));
    }

    if (marker_streamH) {
        ERR2(suites.StreamSuite6()->AEGP_DisposeStream(marker_streamH));
    }

    return err;
}

A_Err SelectedLayersShareColorGroup(
    AEGP_SuiteHandler& suites,
    const std::vector<AEGP_LayerH>& selected_layers,
    bool& share_group)
{
    A_Err err = A_Err_NONE;
    share_group = true;

    if (selected_layers.size() <= 1) {
        return err;
    }

    AEGP_LabelID first_label = 0;
    A_long first_marker_index = 0;
    ERR(suites.LayerSuite9()->AEGP_GetLayerLabel(selected_layers[0], &first_label));

    if (!err && !LabelToMarkerIndex(first_label, first_marker_index)) {
        share_group = false;
        return err;
    }

    for (size_t index = 1; !err && index < selected_layers.size(); ++index) {
        AEGP_LabelID label = 0;
        A_long marker_index = 0;
        ERR(suites.LayerSuite9()->AEGP_GetLayerLabel(selected_layers[index], &label));

        if (!err && (!LabelToMarkerIndex(label, marker_index) || marker_index != first_marker_index)) {
            share_group = false;
            return err;
        }
    }

    return err;
}

A_Err HandleSelectedJumpMarkers(
    const BridgeContext& context,
    AEGP_SuiteHandler& suites,
    AEGP_CompH compH,
    const std::vector<AEGP_LayerH>& selected_layers,
    const A_Time& current_time,
    const A_Time& frame_duration,
    const A_Time& epsilon,
    bool& handled)
{
    A_Err err = A_Err_NONE;
    bool share_group = true;
    handled = false;

    if (selected_layers.empty()) {
        return err;
    }

    ERR(SelectedLayersShareColorGroup(suites, selected_layers, share_group));
    if (err || !share_group) {
        return err;
    }

    for (AEGP_LayerH layerH : selected_layers) {
        ERR(MoveLayerSecondMarkerToTime(
            context,
            suites,
            layerH,
            current_time,
            frame_duration,
            epsilon));
    }

    if (!err) {
        std::vector<AEGP_LayerH> empty_selection;
        ERR(SetSelectedLayers(context, suites, compH, empty_selection));
        handled = true;
    }

    return err;
}

A_Err MoveDirectionalCompMarkerToCurrentTime(
    const BridgeContext& context,
    AEGP_SuiteHandler& suites,
    AEGP_CompH compH,
    const A_Time& current_time,
    const A_Time& epsilon,
    MarkerPickDirection direction)
{
    A_Err err = A_Err_NONE;
    A_Err err2 = A_Err_NONE;
    AEGP_StreamRefH marker_streamH = nullptr;
    A_long marker_count = 0;
    bool cti_on_marker = false;

    ERR(suites.CompSuite12()->AEGP_GetNewCompMarkerStream(
        context.plugin_id,
        compH,
        &marker_streamH));
    ERR(suites.KeyframeSuite5()->AEGP_GetStreamNumKFs(marker_streamH, &marker_count));

    for (A_long index = 0; !err && index < marker_count; ++index) {
        A_Time marker_time;
        AEFX_CLR_STRUCT(marker_time);
        ERR(suites.KeyframeSuite5()->AEGP_GetKeyframeTime(
            marker_streamH,
            index,
            AEGP_LTimeMode_CompTime,
            &marker_time));

        if (!err && TimesNear(marker_time, current_time, epsilon)) {
            cti_on_marker = true;
            break;
        }
    }

    if (!err && !cti_on_marker && marker_count > 0) {
        AEGP_KeyframeIndex chosen_index = -1;
        AEGP_KeyframeIndex fallback_index = -1;
        long double chosen_delta = 0.0L;
        long double fallback_delta = 0.0L;
        bool has_chosen = false;
        bool has_fallback = false;
        const long double current_seconds = ToSeconds(current_time);

        for (A_long index = 0; !err && index < marker_count; ++index) {
            A_Time marker_time;
            AEFX_CLR_STRUCT(marker_time);
            ERR(suites.KeyframeSuite5()->AEGP_GetKeyframeTime(
                marker_streamH,
                index,
                AEGP_LTimeMode_CompTime,
                &marker_time));

            if (!err) {
                const long double delta = ToSeconds(marker_time) - current_seconds;
                const bool is_forward = delta > 0.0L;
                const bool is_backward = delta < 0.0L;
                const bool preferred =
                    (direction == MarkerPickDirection::Forward && is_forward)
                    || (direction == MarkerPickDirection::Backward && is_backward);
                const bool fallback =
                    (direction == MarkerPickDirection::Forward && is_backward)
                    || (direction == MarkerPickDirection::Backward && is_forward);

                if (preferred) {
                    const long double abs_delta = std::fabs(delta);
                    if (!has_chosen || abs_delta < chosen_delta) {
                        has_chosen = true;
                        chosen_delta = abs_delta;
                        chosen_index = index;
                    }
                } else if (fallback) {
                    const long double abs_delta = std::fabs(delta);
                    if (!has_fallback || abs_delta < fallback_delta) {
                        has_fallback = true;
                        fallback_delta = abs_delta;
                        fallback_index = index;
                    }
                }
            }
        }

        if (!has_chosen && has_fallback) {
            chosen_index = fallback_index;
        }

        if (!err && chosen_index >= 0) {
            bool moved = false;
            ERR(MoveKeyframeToTime(
                context,
                suites,
                marker_streamH,
                chosen_index,
                current_time,
                epsilon,
                moved));
        }
    }

    if (marker_streamH) {
        ERR2(suites.StreamSuite6()->AEGP_DisposeStream(marker_streamH));
    }

    return err;
}

A_Err MarkerValueContainsPulo(
    const BridgeContext& context,
    AEGP_SuiteHandler& suites,
    AEGP_MarkerValP markerP,
    bool& matches)
{
    A_Err err = A_Err_NONE;
    A_Err err2 = A_Err_NONE;
    AEGP_MemHandle commentH = nullptr;
    std::string comment;
    matches = false;

    if (!markerP) {
        return err;
    }

    ERR(suites.MarkerSuite3()->AEGP_GetMarkerString(
        context.plugin_id,
        markerP,
        AEGP_MarkerString_COMMENT,
        &commentH));

    if (!err) {
        ERR(MemHandleToLowerAscii(suites, commentH, comment));
    }

    if (!err) {
        matches = ContainsPulo(comment);
    }

    if (commentH) {
        ERR2(suites.MemorySuite1()->AEGP_FreeMemHandle(commentH));
    }

    return err;
}

A_Err KeyframeMarkerContainsPulo(
    const BridgeContext& context,
    AEGP_SuiteHandler& suites,
    AEGP_StreamRefH streamH,
    AEGP_KeyframeIndex key_index,
    bool& matches)
{
    A_Err err = A_Err_NONE;
    A_Err err2 = A_Err_NONE;
    AEGP_StreamValue2 value;
    AEFX_CLR_STRUCT(value);
    bool value_created = false;
    matches = false;

    ERR(suites.KeyframeSuite5()->AEGP_GetNewKeyframeValue(
        context.plugin_id,
        streamH,
        key_index,
        &value));
    if (!err) {
        value_created = true;
        ERR(MarkerValueContainsPulo(context, suites, value.val.markerP, matches));
    }

    if (value_created) {
        ERR2(suites.StreamSuite6()->AEGP_DisposeStreamValue(&value));
    }

    return err;
}

A_Err LayerHasPuloMarker(
    const BridgeContext& context,
    AEGP_SuiteHandler& suites,
    AEGP_LayerH layerH,
    bool& matches)
{
    A_Err err = A_Err_NONE;
    A_Err err2 = A_Err_NONE;
    AEGP_StreamRefH marker_streamH = nullptr;
    A_long key_count = 0;
    matches = false;

    ERR(GetLayerMarkerStream(context, suites, layerH, marker_streamH));
    ERR(suites.KeyframeSuite5()->AEGP_GetStreamNumKFs(marker_streamH, &key_count));

    for (A_long key_index = 0; !err && key_index < key_count; ++key_index) {
        ERR(KeyframeMarkerContainsPulo(
            context,
            suites,
            marker_streamH,
            key_index,
            matches));
        if (matches) {
            break;
        }
    }

    if (marker_streamH) {
        ERR2(suites.StreamSuite6()->AEGP_DisposeStream(marker_streamH));
    }

    return err;
}

A_Err SelectActiveOfertaLayersWithPuloMarker(
    const BridgeContext& context,
    AEGP_SuiteHandler& suites,
    AEGP_CompH compH,
    const A_Time& current_time)
{
    A_Err err = A_Err_NONE;
    A_long layer_count = 0;
    AEGP_CompFlags comp_flags = AEGP_CompFlag_SHOW_ALL_SHY;
    std::vector<AEGP_LayerH> current_selection;
    std::vector<AEGP_LayerH> selected_layers;

    ERR(GetSelectedLayers(context, suites, compH, current_selection));
    if (!err && !current_selection.empty()) {
        std::vector<AEGP_LayerH> empty_selection;
        return SetSelectedLayers(context, suites, compH, empty_selection);
    }

    ERR(suites.LayerSuite9()->AEGP_GetCompNumLayers(compH, &layer_count));
    ERR(suites.CompSuite12()->AEGP_GetCompFlags(compH, &comp_flags));

    const bool show_all_shy = (comp_flags & AEGP_CompFlag_SHOW_ALL_SHY) != 0;

    for (A_long layer_index = 0; !err && layer_index < layer_count; ++layer_index) {
        AEGP_LayerH layerH = nullptr;
        AEGP_LayerFlags layer_flags = AEGP_LayerFlag_NONE;
        A_Boolean layer_is_active = false;
        bool layer_matches = false;
        bool marker_matches = false;

        ERR(suites.LayerSuite9()->AEGP_GetCompLayerByIndex(compH, layer_index, &layerH));
        ERR(suites.LayerSuite9()->AEGP_GetLayerFlags(layerH, &layer_flags));
        if (err || (layer_flags & AEGP_LayerFlag_LOCKED)) {
            continue;
        }

        const bool layer_is_shy = (layer_flags & AEGP_LayerFlag_SHY) != 0;
        if (layer_is_shy && !show_all_shy) {
            continue;
        }

        ERR(suites.LayerSuite9()->AEGP_IsVideoActive(
            layerH,
            AEGP_LTimeMode_CompTime,
            &current_time,
            &layer_is_active));
        if (err || !layer_is_active) {
            continue;
        }

        ERR(LayerMatchesOfertaIndex(context, suites, layerH, layer_matches));
        if (err || !layer_matches) {
            continue;
        }

        ERR(LayerHasPuloMarker(
            context,
            suites,
            layerH,
            marker_matches));

        if (!err && marker_matches) {
            selected_layers.push_back(layerH);
            break;
        }
    }

    if (!err) {
        ERR(SetSelectedLayers(context, suites, compH, selected_layers));
    }

    return err;
}

A_Err LayerHasIndexedJumpMarker(
    const BridgeContext& context,
    AEGP_SuiteHandler& suites,
    AEGP_LayerH layerH,
    bool& matches)
{
    A_Err err = A_Err_NONE;
    A_Err err2 = A_Err_NONE;
    AEGP_StreamRefH marker_streamH = nullptr;
    A_long key_count = 0;
    matches = false;

    ERR(GetLayerMarkerStream(context, suites, layerH, marker_streamH));
    ERR(suites.KeyframeSuite5()->AEGP_GetStreamNumKFs(marker_streamH, &key_count));

    if (!err) {
        matches = key_count >= 2;
    }

    if (marker_streamH) {
        ERR2(suites.StreamSuite6()->AEGP_DisposeStream(marker_streamH));
    }

    return err;
}

A_Err GetLayerMarkerIndexByLabel(
    AEGP_SuiteHandler& suites,
    AEGP_LayerH layerH,
    A_long& marker_index,
    bool& matches)
{
    A_Err err = A_Err_NONE;
    AEGP_LabelID label = 0;
    marker_index = 0;
    matches = false;

    ERR(suites.LayerSuite9()->AEGP_GetLayerLabel(layerH, &label));
    if (!err) {
        matches = LabelToMarkerIndex(label, marker_index);
    }

    return err;
}

A_Err FindLayerGroupStartTimeForMarker(
    const BridgeContext& context,
    AEGP_SuiteHandler& suites,
    AEGP_CompH compH,
    A_long marker_index,
    const A_Time& preferred_time,
    const A_Time& epsilon,
    A_Time& group_start_time,
    bool& found)
{
    A_Err err = A_Err_NONE;
    A_long layer_count = 0;
    found = false;
    AEFX_CLR_STRUCT(group_start_time);

    ERR(suites.LayerSuite9()->AEGP_GetCompNumLayers(compH, &layer_count));

    for (A_long layer_index = 0; !err && layer_index < layer_count; ++layer_index) {
        AEGP_LayerH layerH = nullptr;
        AEGP_LayerFlags layer_flags = AEGP_LayerFlag_NONE;
        A_long layer_marker_index = 0;
        bool label_matches = false;
        bool has_jump_marker = false;
        A_Time layer_offset;
        AEFX_CLR_STRUCT(layer_offset);

        ERR(suites.LayerSuite9()->AEGP_GetCompLayerByIndex(compH, layer_index, &layerH));
        ERR(suites.LayerSuite9()->AEGP_GetLayerFlags(layerH, &layer_flags));
        if (err || (layer_flags & AEGP_LayerFlag_LOCKED)) {
            continue;
        }

        ERR(GetLayerMarkerIndexByLabel(suites, layerH, layer_marker_index, label_matches));
        if (err || !label_matches || layer_marker_index != marker_index) {
            continue;
        }

        ERR(LayerHasIndexedJumpMarker(context, suites, layerH, has_jump_marker));
        if (err || !has_jump_marker) {
            continue;
        }

        ERR(suites.LayerSuite9()->AEGP_GetLayerOffset(layerH, &layer_offset));
        if (err) {
            continue;
        }

        if (!found) {
            group_start_time = layer_offset;
            found = true;
        }

        if (TimesNear(layer_offset, preferred_time, epsilon)) {
            group_start_time = layer_offset;
            return err;
        }
    }

    return err;
}

A_Err MoveLayerGroupToTime(
    AEGP_SuiteHandler& suites,
    AEGP_CompH compH,
    A_long marker_index,
    const A_Time& source_time,
    const A_Time& target_time,
    const A_Time& epsilon)
{
    A_Err err = A_Err_NONE;
    A_long layer_count = 0;

    ERR(suites.LayerSuite9()->AEGP_GetCompNumLayers(compH, &layer_count));

    for (A_long layer_index = 0; !err && layer_index < layer_count; ++layer_index) {
        AEGP_LayerH layerH = nullptr;
        AEGP_LayerFlags layer_flags = AEGP_LayerFlag_NONE;
        A_long layer_marker_index = 0;
        bool label_matches = false;
        A_Time layer_offset;
        AEFX_CLR_STRUCT(layer_offset);

        ERR(suites.LayerSuite9()->AEGP_GetCompLayerByIndex(compH, layer_index, &layerH));
        ERR(suites.LayerSuite9()->AEGP_GetLayerFlags(layerH, &layer_flags));
        if (err || (layer_flags & AEGP_LayerFlag_LOCKED)) {
            continue;
        }

        ERR(GetLayerMarkerIndexByLabel(suites, layerH, layer_marker_index, label_matches));
        if (err || !label_matches || layer_marker_index != marker_index) {
            continue;
        }

        ERR(suites.LayerSuite9()->AEGP_GetLayerOffset(layerH, &layer_offset));
        if (err || !TimesNear(layer_offset, source_time, epsilon)) {
            continue;
        }

        if (!TimesNear(layer_offset, target_time, epsilon)) {
            ERR(suites.LayerSuite9()->AEGP_SetLayerOffset(layerH, &target_time));
        }
    }

    return err;
}

A_Err SelectOfferLayersAtTime(
    const BridgeContext& context,
    AEGP_SuiteHandler& suites,
    AEGP_CompH compH,
    A_long marker_index,
    const A_Time& start_time,
    const A_Time& epsilon)
{
    A_Err err = A_Err_NONE;
    A_long layer_count = 0;
    AEGP_CompFlags comp_flags = AEGP_CompFlag_SHOW_ALL_SHY;
    std::vector<AEGP_LayerH> selected_layers;

    ERR(suites.LayerSuite9()->AEGP_GetCompNumLayers(compH, &layer_count));
    ERR(suites.CompSuite12()->AEGP_GetCompFlags(compH, &comp_flags));

    const bool show_all_shy = (comp_flags & AEGP_CompFlag_SHOW_ALL_SHY) != 0;

    for (A_long layer_index = 0; !err && layer_index < layer_count; ++layer_index) {
        AEGP_LayerH layerH = nullptr;
        AEGP_LayerFlags layer_flags = AEGP_LayerFlag_NONE;
        A_long layer_marker_index = 0;
        bool label_matches = false;
        bool has_jump_marker = false;
        A_Time layer_offset;
        AEFX_CLR_STRUCT(layer_offset);

        ERR(suites.LayerSuite9()->AEGP_GetCompLayerByIndex(compH, layer_index, &layerH));
        ERR(suites.LayerSuite9()->AEGP_GetLayerFlags(layerH, &layer_flags));
        if (err || (layer_flags & AEGP_LayerFlag_LOCKED)) {
            continue;
        }

        const bool layer_is_shy = (layer_flags & AEGP_LayerFlag_SHY) != 0;
        if (layer_is_shy && !show_all_shy) {
            continue;
        }

        ERR(GetLayerMarkerIndexByLabel(suites, layerH, layer_marker_index, label_matches));
        if (err || !label_matches || layer_marker_index != marker_index) {
            continue;
        }

        ERR(LayerHasIndexedJumpMarker(context, suites, layerH, has_jump_marker));
        if (err || !has_jump_marker) {
            continue;
        }

        ERR(suites.LayerSuite9()->AEGP_GetLayerOffset(layerH, &layer_offset));
        if (!err && TimesNear(layer_offset, start_time, epsilon)) {
            selected_layers.push_back(layerH);
        }
    }

    if (!err) {
        ERR(SetSelectedLayers(context, suites, compH, selected_layers));
    }

    return err;
}

struct StoredCompMarker {
    AEGP_StreamValue2 value;
    A_Time original_time;
    A_Time group_start_time;
    bool has_value;
    bool has_group_start_time;
};

A_Err MoveTailCompMarkers(
    const BridgeContext& context,
    AEGP_SuiteHandler& suites,
    AEGP_CompH compH,
    AEGP_StreamRefH marker_streamH,
    const A_Time& comp_duration,
    const A_Time& frame_duration,
    const A_Time& epsilon)
{
    A_Err err = A_Err_NONE;
    A_long marker_count = 0;
    StoredCompMarker markers[7];

    for (A_long index = 0; index < 7; ++index) {
        AEFX_CLR_STRUCT(markers[index].value);
        AEFX_CLR_STRUCT(markers[index].original_time);
        AEFX_CLR_STRUCT(markers[index].group_start_time);
        markers[index].has_value = false;
        markers[index].has_group_start_time = false;
    }

    ERR(suites.KeyframeSuite5()->AEGP_GetStreamNumKFs(marker_streamH, &marker_count));
    if (!err && marker_count < 6) {
        return A_Err_GENERIC;
    }

    for (A_long marker_index = 2; !err && marker_index <= 6; ++marker_index) {
        const AEGP_KeyframeIndex key_index = marker_index - 1;

        ERR(suites.KeyframeSuite5()->AEGP_GetKeyframeTime(
            marker_streamH,
            key_index,
            AEGP_LTimeMode_CompTime,
            &markers[marker_index].original_time));
        ERR(suites.KeyframeSuite5()->AEGP_GetNewKeyframeValue(
            context.plugin_id,
            marker_streamH,
            key_index,
            &markers[marker_index].value));
        if (!err) {
            markers[marker_index].has_value = true;
        }

        ERR(FindLayerGroupStartTimeForMarker(
            context,
            suites,
            compH,
            marker_index,
            markers[marker_index].original_time,
            epsilon,
            markers[marker_index].group_start_time,
            markers[marker_index].has_group_start_time));
    }

    for (A_long marker_index = 6; !err && marker_index >= 2; --marker_index) {
        ERR(suites.KeyframeSuite5()->AEGP_DeleteKeyframe(marker_streamH, marker_index - 1));
    }

    for (A_long marker_index = 2; !err && marker_index <= 6; ++marker_index) {
        if (!markers[marker_index].has_value) {
            continue;
        }

        const A_Time target_time = TailMarkerTime(comp_duration, frame_duration, marker_index);
        AEGP_KeyframeIndex new_key_index = 0;

        ERR(suites.KeyframeSuite5()->AEGP_InsertKeyframe(
            marker_streamH,
            AEGP_LTimeMode_CompTime,
            &target_time,
            &new_key_index));
        ERR(suites.KeyframeSuite5()->AEGP_SetKeyframeValue(
            marker_streamH,
            new_key_index,
            &markers[marker_index].value));

        if (!err && markers[marker_index].has_group_start_time) {
            ERR(MoveLayerGroupToTime(
                suites,
                compH,
                marker_index,
                markers[marker_index].group_start_time,
                target_time,
                epsilon));
        }
    }

    for (A_long marker_index = 2; marker_index <= 6; ++marker_index) {
        if (markers[marker_index].has_value) {
            A_Err err2 = A_Err_NONE;
            ERR2(suites.StreamSuite6()->AEGP_DisposeStreamValue(&markers[marker_index].value));
        }
    }

    return err;
}

A_Err AlignLayersToColorMarkers(
    const BridgeContext& context,
    AEGP_SuiteHandler& suites,
    AEGP_CompH compH,
    const std::vector<AEGP_LayerH>& initial_selection,
    const A_Time& current_time,
    const A_Time& epsilon)
{
    A_Err err = A_Err_NONE;
    A_Err err2 = A_Err_NONE;
    AEGP_StreamRefH marker_streamH = nullptr;
    A_long marker_count = 0;
    A_long layer_count = 0;
    AEGP_CompFlags comp_flags = AEGP_CompFlag_SHOW_ALL_SHY;
    std::vector<AEGP_LayerH> final_selection = initial_selection;

    ERR(suites.CompSuite12()->AEGP_GetNewCompMarkerStream(
        context.plugin_id,
        compH,
        &marker_streamH));
    ERR(suites.KeyframeSuite5()->AEGP_GetStreamNumKFs(marker_streamH, &marker_count));
    ERR(suites.LayerSuite9()->AEGP_GetCompNumLayers(compH, &layer_count));
    ERR(suites.CompSuite12()->AEGP_GetCompFlags(compH, &comp_flags));

    const bool show_all_shy = (comp_flags & AEGP_CompFlag_SHOW_ALL_SHY) != 0;

    for (A_long layer_index = 0; !err && layer_index < layer_count; ++layer_index) {
        AEGP_LayerH layerH = nullptr;
        AEGP_LayerFlags layer_flags = AEGP_LayerFlag_NONE;
        AEGP_LabelID label = 0;
        A_long marker_index = 0;

        ERR(suites.LayerSuite9()->AEGP_GetCompLayerByIndex(compH, layer_index, &layerH));
        ERR(suites.LayerSuite9()->AEGP_GetLayerFlags(layerH, &layer_flags));
        if (err || (layer_flags & AEGP_LayerFlag_LOCKED)) {
            continue;
        }

        ERR(suites.LayerSuite9()->AEGP_GetLayerLabel(layerH, &label));
        if (err || !LabelToMarkerIndex(label, marker_index) || marker_count < marker_index) {
            continue;
        }

        A_Time target_time;
        AEFX_CLR_STRUCT(target_time);
        ERR(suites.KeyframeSuite5()->AEGP_GetKeyframeTime(
            marker_streamH,
            marker_index - 1,
            AEGP_LTimeMode_CompTime,
            &target_time));

        ERR(suites.LayerSuite9()->AEGP_SetLayerOffset(layerH, &target_time));

        const bool layer_is_shy = (layer_flags & AEGP_LayerFlag_SHY) != 0;
        if (!err && TimesNear(target_time, current_time, epsilon) && (!layer_is_shy || show_all_shy)) {
            if (!ContainsLayer(final_selection, layerH)) {
                final_selection.push_back(layerH);
            }
        }
    }

    if (!err) {
        ERR(SetSelectedLayers(context, suites, compH, final_selection));
    }

    if (marker_streamH) {
        ERR2(suites.StreamSuite6()->AEGP_DisposeStream(marker_streamH));
    }

    return err;
}

A_Err PrepareActiveCompTiming(
    AEGP_SuiteHandler& suites,
    AEGP_CompH& compH,
    A_Time& current_time,
    A_Time& frame_duration,
    A_Time& epsilon)
{
    A_Err err = A_Err_NONE;
    AEGP_ItemH comp_itemH = nullptr;
    AEFX_CLR_STRUCT(current_time);
    AEFX_CLR_STRUCT(frame_duration);

    ERR(GetActiveComp(suites, compH));
    ERR(suites.CompSuite12()->AEGP_GetItemFromComp(compH, &comp_itemH));
    ERR(suites.ItemSuite9()->AEGP_GetItemCurrentTime(comp_itemH, &current_time));
    ERR(suites.CompSuite12()->AEGP_GetCompFrameDuration(compH, &frame_duration));

    if (!err) {
        epsilon = HalfTime(frame_duration);
    }

    return err;
}

} // namespace

A_Err RunMoveLayersToMarkers(const BridgeContext& context)
{
    return RunMoveLayersToMarkers(context, MarkerPickDirection::Forward);
}

A_Err RunMoveLayersToMarkers(const BridgeContext& context, MarkerPickDirection direction)
{
    A_Err err = A_Err_NONE;
    A_Err err2 = A_Err_NONE;
    AEGP_SuiteHandler suites(context.sp);
    AEGP_CompH compH = nullptr;
    A_Time current_time;
    A_Time frame_duration;
    A_Time epsilon;
    AEFX_CLR_STRUCT(current_time);
    AEFX_CLR_STRUCT(frame_duration);
    AEFX_CLR_STRUCT(epsilon);
    std::vector<AEGP_LayerH> selected_layers;
    bool undo_started = false;

    ERR(suites.UtilitySuite6()->AEGP_StartUndoGroup("Mover layers para markers"));
    if (!err) {
        undo_started = true;
    }

    ERR(PrepareActiveCompTiming(suites, compH, current_time, frame_duration, epsilon));

    ERR(GetSelectedLayers(context, suites, compH, selected_layers));

    if (!err) {
        ERR(MoveDirectionalCompMarkerToCurrentTime(
            context,
            suites,
            compH,
            current_time,
            epsilon,
            direction));
        ERR(AlignLayersToColorMarkers(context, suites, compH, selected_layers, current_time, epsilon));
    }

    if (undo_started) {
        ERR2(suites.UtilitySuite6()->AEGP_EndUndoGroup());
    }

    return err;
}

A_Err RunMoveSelectedJumpMarkers(const BridgeContext& context)
{
    A_Err err = A_Err_NONE;
    A_Err err2 = A_Err_NONE;
    AEGP_SuiteHandler suites(context.sp);
    AEGP_CompH compH = nullptr;
    A_Time current_time;
    A_Time frame_duration;
    A_Time epsilon;
    AEFX_CLR_STRUCT(current_time);
    AEFX_CLR_STRUCT(frame_duration);
    AEFX_CLR_STRUCT(epsilon);
    std::vector<AEGP_LayerH> selected_layers;
    bool undo_started = false;

    ERR(suites.UtilitySuite6()->AEGP_StartUndoGroup("Mover marker pulo"));
    if (!err) {
        undo_started = true;
    }

    ERR(PrepareActiveCompTiming(suites, compH, current_time, frame_duration, epsilon));
    ERR(GetSelectedLayers(context, suites, compH, selected_layers));

    bool handled_jump_markers = false;
    ERR(HandleSelectedJumpMarkers(
        context,
        suites,
        compH,
        selected_layers,
        current_time,
        frame_duration,
        epsilon,
        handled_jump_markers));

    if (undo_started) {
        ERR2(suites.UtilitySuite6()->AEGP_EndUndoGroup());
    }

    return err;
}

A_Err RunSelectLayersWithJumpMarkerAtCurrentTime(const BridgeContext& context)
{
    A_Err err = A_Err_NONE;
    A_Err err2 = A_Err_NONE;
    AEGP_SuiteHandler suites(context.sp);
    AEGP_CompH compH = nullptr;
    A_Time current_time;
    A_Time frame_duration;
    A_Time epsilon;
    AEFX_CLR_STRUCT(current_time);
    AEFX_CLR_STRUCT(frame_duration);
    AEFX_CLR_STRUCT(epsilon);
    bool undo_started = false;

    ERR(suites.UtilitySuite6()->AEGP_StartUndoGroup("Selecionar marker pulo"));
    if (!err) {
        undo_started = true;
    }

    ERR(PrepareActiveCompTiming(suites, compH, current_time, frame_duration, epsilon));
    ERR(SelectActiveOfertaLayersWithPuloMarker(context, suites, compH, current_time));

    if (undo_started) {
        ERR2(suites.UtilitySuite6()->AEGP_EndUndoGroup());
    }

    return err;
}

A_Err RunAdjustTimelineMarkersToTail(const BridgeContext& context)
{
    A_Err err = A_Err_NONE;
    A_Err err2 = A_Err_NONE;
    AEGP_SuiteHandler suites(context.sp);
    AEGP_CompH compH = nullptr;
    AEGP_ItemH itemH = nullptr;
    AEGP_StreamRefH marker_streamH = nullptr;
    A_long marker_count = 0;
    A_Time comp_duration;
    A_Time frame_duration;
    A_Time epsilon;
    A_Time first_marker_time;
    A_Time first_group_start_time;
    bool has_first_group_start_time = false;
    bool undo_started = false;
    AEFX_CLR_STRUCT(comp_duration);
    AEFX_CLR_STRUCT(frame_duration);
    AEFX_CLR_STRUCT(epsilon);
    AEFX_CLR_STRUCT(first_marker_time);
    AEFX_CLR_STRUCT(first_group_start_time);

    ERR(FindTimelineComp(context, suites, compH, itemH));
    ERR(suites.ItemSuite9()->AEGP_GetItemDuration(itemH, &comp_duration));
    ERR(suites.CompSuite12()->AEGP_GetCompFrameDuration(compH, &frame_duration));
    if (!err) {
        epsilon = HalfTime(frame_duration);
    }

    ERR(suites.CompSuite12()->AEGP_GetNewCompMarkerStream(
        context.plugin_id,
        compH,
        &marker_streamH));
    ERR(suites.KeyframeSuite5()->AEGP_GetStreamNumKFs(marker_streamH, &marker_count));
    if (!err && marker_count < 6) {
        err = A_Err_GENERIC;
    }

    if (!err) {
        ERR(suites.UtilitySuite6()->AEGP_StartUndoGroup("Ajustar markers para o fundo"));
        if (!err) {
            undo_started = true;
        }
    }

    ERR(suites.KeyframeSuite5()->AEGP_GetKeyframeTime(
        marker_streamH,
        0,
        AEGP_LTimeMode_CompTime,
        &first_marker_time));
    ERR(FindLayerGroupStartTimeForMarker(
        context,
        suites,
        compH,
        1,
        first_marker_time,
        epsilon,
        first_group_start_time,
        has_first_group_start_time));

    ERR(MoveTailCompMarkers(
        context,
        suites,
        compH,
        marker_streamH,
        comp_duration,
        frame_duration,
        epsilon));

    if (!err) {
        const A_Time selected_time = ClampTimeToComp(
            has_first_group_start_time ? first_group_start_time : first_marker_time,
            comp_duration);
        ERR(suites.ItemSuite9()->AEGP_SetItemCurrentTime(itemH, &selected_time));
        ERR(SelectOfferLayersAtTime(context, suites, compH, 1, selected_time, epsilon));
    }

    if (marker_streamH) {
        ERR2(suites.StreamSuite6()->AEGP_DisposeStream(marker_streamH));
    }

    if (undo_started) {
        ERR2(suites.UtilitySuite6()->AEGP_EndUndoGroup());
    }

    return err;
}
