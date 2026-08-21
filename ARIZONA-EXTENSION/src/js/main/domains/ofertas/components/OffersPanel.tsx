import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from "react";
import type { LocalImage } from "../productImages/types";
import { useOfferShortcuts } from "../hooks/useOfferShortcuts";
import { useOffersEditor } from "../hooks/useOffersEditor";
import { getPublicErrorMessage } from "../../../utils/errors";
import {
  createOfferRasterPreview,
  createOfferPsdPreview,
  isRasterOfferImage,
  isPsdFile,
} from "../services/offerImagePreview";
import type {
  OfferImageInfo,
  OfferInstallmentJumpTarget,
  OfferLegalControl,
  OfferOptionGroup,
  OfferProduct,
  OfferTextField,
} from "../types";
import { normalizeOfferPrice } from "../utils/price";
import { isEditableOfferTextControl } from "../utils/keyboard";
import { isRnAfterProject } from "../utils/projectRegion";
import "./offers.scss";

interface OffersPanelProps {
  projectName: string;
  productImages: LocalImage[];
  requestedOfferLayerIndex?: number;
  onLoadProductPreview: (image: LocalImage) => Promise<void>;
  onRefreshProductImages?: () => Promise<void>;
  onBeforeOfferNavigation?: () => Promise<boolean>;
  onRequestedOfferLayerIndexHandled?: () => void;
  onStatus: (message: string) => void;
}

interface OfferFieldControlProps {
  field: OfferTextField;
  onCommit: (value: string) => void;
  className?: string;
}

interface OfferImageThumbnailProps {
  image: OfferImageInfo | null;
  onDoubleClick: () => void;
  skuName: string;
  previewRevision: number;
}

interface DoubleClickActivation<T extends HTMLElement> {
  activateNextFocus: () => void;
  deactivate: () => void;
  handleDoubleClick: (event: MouseEvent<T>) => void;
  handleFocus: (event: FocusEvent<T>) => void;
  handleMouseDown: (event: MouseEvent<T>) => void;
  isEditing: boolean;
  ref: RefObject<T | null>;
}

interface ProductEditorProps {
  isRnProject: boolean;
  offerLayerIndex: number;
  product: OfferProduct;
  previewRevision: number;
  onDescriptionChange: (
    offerLayerIndex: number,
    productIndex: number,
    value: string
  ) => void;
  onDescriptionExpressionChange: (
    offerLayerIndex: number,
    productIndex: number,
    enabled: boolean
  ) => void;
  onFieldChange: (
    offerLayerIndex: number,
    productIndex: number,
    fieldId: string,
    value: string,
    fieldIndex?: number
  ) => void;
  onOptionChange: (
    offerLayerIndex: number,
    productIndex: number,
    optionGroupId: string,
    selectedIndex: number
  ) => void;
  onInstallmentJumpChange: (
    offerLayerIndex: number,
    productIndex: number,
    target: OfferInstallmentJumpTarget
  ) => void;
  onOpenImagePicker: (productIndex: number) => void;
  draggedProduct: DraggedOfferProduct | null;
  onProductDragEnd: () => void;
  onProductDragStart: (payload: DraggedOfferProduct) => void;
  onSwapProducts: (
    offerLayerIndex: number,
    sourceProductIndex: number,
    targetProductIndex: number,
    openOfferPrecomp: boolean
  ) => void;
}

interface OfferLegalSettingsProps {
  controls: OfferLegalControl[];
  legalText: OfferTextField | null;
  offerLayerIndex: number;
  onClose: () => void;
  onControlChange: (
    offerLayerIndex: number,
    controlId: string,
    enabled: boolean
  ) => void;
  onControlOptionChange: (
    offerLayerIndex: number,
    controlId: string,
    selectedIndex: number
  ) => void;
  onControlValueChange: (
    offerLayerIndex: number,
    controlId: string,
    value: string
  ) => void;
}

type OfferCardSize = "short" | "medium" | "tall";

interface DraggedOfferProduct {
  offerLayerIndex: number;
  productIndex: number;
}

interface DraggedOfferTab {
  offerLayerIndex: number;
}

interface ImagePickerTarget {
  offerLayerIndex: number;
  productIndex: number;
}

interface IndexedOfferField {
  field: OfferTextField;
  fieldIndex: number;
}

const OFFER_TAB_COLORS: { [offerIndex: number]: string } = {
  1: "#B53838",
  2: "#E4D84C",
  3: "#677DE0",
  4: "#4AA44C",
  5: "#8E2C9A",
  6: "#E8920D",
};

const OFFER_PRODUCT_DRAG_MIME = "application/x-arizona-offer-product";
const OFFER_TAB_DRAG_MIME = "application/x-arizona-offer-tab";
const OFFER_TAB_DRAG_HOLD_MS = 350;
const OFFER_TAB_POST_DRAG_CLICK_SUPPRESSION_MS = 250;

let shouldEditNextFocusedTextControl = false;
let nextFocusedTextControlTimer = 0;

const clearDocumentSelection = () => {
  window.getSelection()?.removeAllRanges();
};

const serializeDraggedOfferProduct = (payload: DraggedOfferProduct) =>
  JSON.stringify(payload);

const readDraggedOfferProduct = (
  event: DragEvent<HTMLElement>
): DraggedOfferProduct | null => {
  const rawPayload = event.dataTransfer.getData(OFFER_PRODUCT_DRAG_MIME);

  if (!rawPayload) return null;

  try {
    const parsedPayload = JSON.parse(rawPayload) as Partial<DraggedOfferProduct>;

    if (
      typeof parsedPayload.offerLayerIndex === "number" &&
      typeof parsedPayload.productIndex === "number"
    ) {
      return {
        offerLayerIndex: parsedPayload.offerLayerIndex,
        productIndex: parsedPayload.productIndex,
      };
    }
  } catch (error) {
  }

  return null;
};

const readDraggedOfferTab = (
  event: DragEvent<HTMLElement>
): DraggedOfferTab | null => {
  const rawPayload = event.dataTransfer.getData(OFFER_TAB_DRAG_MIME);

  if (!rawPayload) return null;

  const offerLayerIndex = Number(rawPayload);
  return isFinite(offerLayerIndex) && offerLayerIndex > 0
    ? { offerLayerIndex }
    : null;
};

const getOfferTabColor = (markerIndex: number, fallbackIndex: number) =>
  OFFER_TAB_COLORS[markerIndex] ||
  OFFER_TAB_COLORS[((fallbackIndex % 6) + 1)] ||
  "#ff6400";

const getOfferTabName = (index: number) => "OFT " + (index + 1);

const getOfferTabFullName = (index: number) => "Oferta " + (index + 1);

const toOfferDescriptionText = (value: string) =>
  value.toLocaleUpperCase("pt-BR");

const commitDescriptionTextArea =
  (originalValue: string, onCommit: (value: string) => void) =>
  (event: FocusEvent<HTMLTextAreaElement>) => {
    const nextValue = toOfferDescriptionText(event.currentTarget.value);
    const normalizedOriginalValue = toOfferDescriptionText(originalValue);

    event.currentTarget.value = nextValue;
    if (nextValue !== normalizedOriginalValue) {
      onCommit(nextValue);
    }
  };

const keepDigits = (value: string) => String(value || "").replace(/\D/g, "");

const normalizeOfferInteger = (value: string) => keepDigits(value);

const normalizeOfferPercent = (value: string) => keepDigits(value);

const normalizeFieldValue = (field: OfferTextField, value: string) => {
  if (field.format === "price") return normalizeOfferPrice(value);
  if (field.format === "integer") return normalizeOfferInteger(value);
  if (field.format === "percent") return normalizeOfferPercent(value);

  return value;
};

const keepPriceEditCharacters = (value: string) =>
  String(value || "").replace(/[^0-9,.]/g, "");

const getEditableFieldValue = (field: OfferTextField, value: string) => {
  if (field.format === "price") return keepPriceEditCharacters(value);
  if (field.format === "integer" || field.format === "percent") {
    return keepDigits(value);
  }

  return value;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const getOfferDescriptionRows = (value: string) => {
  const normalizedValue = toOfferDescriptionText(value);
  const lines = normalizedValue.split(/\r\n|\r|\n/);
  const estimatedLines = lines.reduce((total, line) => {
    const lineLength = line.trim().length;

    return total + Math.max(1, Math.ceil(lineLength / 34));
  }, 0);

  return clamp(estimatedLines, 1, 5);
};

const useDoubleClickActivation = <T extends HTMLElement>(
  enabled: boolean
): DoubleClickActivation<T> => {
  const [isEditing, setIsEditing] = useState(false);
  const isEditingRef = useRef(false);
  const ref = useRef<T>(null);

  const setEditing = (nextIsEditing: boolean) => {
    isEditingRef.current = nextIsEditing;
    setIsEditing(nextIsEditing);
  };

  useEffect(() => {
    if (enabled) return;

    setEditing(false);
  }, [enabled]);

  const activate = () => {
    if (!enabled) return;

    setEditing(true);
    window.requestAnimationFrame(() => {
      ref.current?.focus();
    });
  };

  const activateNextFocus = () => {
    shouldEditNextFocusedTextControl = true;

    window.clearTimeout(nextFocusedTextControlTimer);
    nextFocusedTextControlTimer = window.setTimeout(() => {
      shouldEditNextFocusedTextControl = false;
    }, 180);
  };

  const handleMouseDown = (event: MouseEvent<T>) => {
    if (!enabled || isEditingRef.current) return;

    if (event.detail >= 2) {
      clearDocumentSelection();
      activate();
      return;
    }

    event.preventDefault();
    clearDocumentSelection();
  };

  const handleDoubleClick = () => {
    activate();
  };

  const handleFocus = (event: FocusEvent<T>) => {
    if (!enabled || isEditingRef.current) return;

    if (shouldEditNextFocusedTextControl) {
      shouldEditNextFocusedTextControl = false;
      setEditing(true);
      return;
    }

    event.currentTarget.blur();
  };

  return {
    activateNextFocus,
    deactivate: () => setEditing(false),
    handleDoubleClick,
    handleFocus,
    handleMouseDown,
    isEditing,
    ref,
  };
};

const isUndoKey = (event: KeyboardEvent<HTMLElement>) => {
  if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) {
    return false;
  }

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  return key === "z" || event.code === "KeyZ" || event.keyCode === 90;
};

const getImageTitle = (image: OfferImageInfo | null) => {
  if (image === null) return "Imagem nao encontrada.";

  const details = [
    image.layerName,
    image.sourceName,
    image.filePath,
  ].filter(Boolean);

  return details.join("\n");
};

const getHeaderOptionGroup = (product: OfferProduct) =>
  product.mechanic.optionGroups.find(
    (optionGroup) => optionGroup.placement === "header"
  );

const getControlOptionGroups = (product: OfferProduct) =>
  product.mechanic.optionGroups.filter(
    (optionGroup) => optionGroup.placement !== "header"
  );

const getOfferCardSize = (product: OfferProduct): OfferCardSize => {
  const type = product.mechanic.type.toLowerCase();
  const controlCount =
    product.mechanic.fields.length + getControlOptionGroups(product).length;

  if (type.indexOf("parcelamento") >= 0 || controlCount >= 5) {
    return "tall";
  }

  if (type.indexOf("de ") >= 0 || controlCount >= 4) {
    return "medium";
  }

  return "short";
};

const getOfferProductClassName = (product: OfferProduct) => {
  const classNames = [
    "offer-product-editor",
    "is-" + getOfferCardSize(product),
  ];

  if (product.unsupported) {
    classNames.push("is-unsupported");
  }

  return classNames.join(" ");
};

const getBaseName = (filePath: string) => {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");

  return parts[parts.length - 1] || normalized;
};

const stripExtension = (name: string) => {
  const dotIndex = name.lastIndexOf(".");

  return dotIndex > 0 ? name.substring(0, dotIndex) : name;
};

const getOfferSkuName = (product: OfferProduct) => {
  const image = product.image;
  const source =
    image?.filePath ||
    image?.sourceName ||
    image?.layerName ||
    "Produto " + (product.index + 1);

  return stripExtension(getBaseName(source));
};

const getIndexedFields = (product: OfferProduct): IndexedOfferField[] =>
  product.mechanic.fields.map((field, fieldIndex) => ({
    field,
    fieldIndex,
  }));

const getPriceFields = (product: OfferProduct) =>
  getIndexedFields(product).filter(({ field }) => field.format === "price");

const getExtraFields = (product: OfferProduct) =>
  getIndexedFields(product).filter(({ field }) => field.format !== "price");

const isQuantityXField = (field: OfferTextField) =>
  field.id === "quantidade-x";

const isInstallmentsField = (field: OfferTextField) =>
  field.id === "numero-de-parcelas";

const getFieldDisplayLabel = (field: OfferTextField) =>
  isQuantityXField(field) ? "Quantidade" : field.label;

const isValueField = (field: OfferTextField) =>
  field.format === "price" ||
  field.format === "percent" ||
  field.format === "integer";

const getFieldClassName = (field: OfferTextField, baseClassName: string) => {
  const classNames = [baseClassName];

  if (isValueField(field)) {
    classNames.push("offer-value-field");
  }

  if (field.format === "percent") {
    classNames.push("offer-percent-field");
  }

  if (isInstallmentsField(field)) {
    classNames.push("offer-installments-field");
  }

  return classNames.join(" ");
};

const OfferImageThumbnail = ({
  image,
  onDoubleClick,
  previewRevision,
  skuName,
}: OfferImageThumbnailProps) => {
  const [failed, setFailed] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewStatus, setPreviewStatus] = useState<
    "idle" | "loading" | "failed"
  >("idle");
  const filePath = image?.filePath || "";
  const canUseRasterPreview = filePath !== "" && isRasterOfferImage(filePath);
  const canUsePsdPreview = filePath !== "" && isPsdFile(filePath);
  const canPreview = previewUrl !== "" && !failed;

  useEffect(() => {
    let cancelled = false;

    setFailed(false);
    setPreviewUrl("");

    if (!canUseRasterPreview && !canUsePsdPreview) {
      setPreviewStatus("idle");
      return () => {
        cancelled = true;
      };
    }

    setPreviewStatus("loading");

    const previewPromise = canUseRasterPreview
      ? Promise.resolve(createOfferRasterPreview(filePath))
      : createOfferPsdPreview(filePath);

    void previewPromise
      .then((nextPreviewUrl) => {
        if (cancelled) return;

        setPreviewUrl(nextPreviewUrl);
        setPreviewStatus("idle");
      })
      .catch(() => {
        if (cancelled) return;

        setPreviewStatus("failed");
      });

    return () => {
      cancelled = true;
    };
  }, [canUsePsdPreview, canUseRasterPreview, filePath, previewRevision]);

  return (
    <div
      className={
        canPreview
          ? "offer-product-image has-preview"
          : "offer-product-image is-empty"
      }
      title={getImageTitle(image)}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onDoubleClick();
      }}
    >
      <div className="offer-product-image-frame">
        {canPreview ? (
          <img src={previewUrl} alt="" onError={() => setFailed(true)} />
        ) : (
          <span>{previewStatus === "loading" ? "..." : "IMG"}</span>
        )}
      </div>
      <span className="offer-product-sku" title={skuName}>
        {skuName}
      </span>
    </div>
  );
};

const OfferFieldControl = ({
  field,
  onCommit,
  className = "",
}: OfferFieldControlProps) => {
  const [value, setValue] = useState(normalizeFieldValue(field, field.value));
  const activation = useDoubleClickActivation<HTMLInputElement>(field.enabled);
  const skipNextBlurCommitRef = useRef(false);
  const editStartValueRef = useRef(normalizeFieldValue(field, field.value));
  const label = getFieldDisplayLabel(field);

  useEffect(() => {
    const nextValue = normalizeFieldValue(field, field.value);
    editStartValueRef.current = nextValue;
    setValue(nextValue);
  }, [field.format, field.value]);

  const commitValue = (nextValue: string) => {
    const normalizedValue = normalizeFieldValue(field, nextValue);
    const originalValue = normalizeFieldValue(field, field.value);

    setValue(normalizedValue);
    if (normalizedValue !== originalValue) {
      onCommit(normalizedValue);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isUndoKey(event) && activation.isEditing) {
      event.preventDefault();
      event.stopPropagation();
      setValue(editStartValueRef.current);
      return;
    }

    if (event.key === "Tab" && activation.isEditing) {
      commitValue(event.currentTarget.value);
      skipNextBlurCommitRef.current = true;
      activation.activateNextFocus();
      activation.deactivate();
      return;
    }

    if (event.key !== "Enter") return;

    event.preventDefault();
    commitValue(event.currentTarget.value);
    skipNextBlurCommitRef.current = true;
    activation.deactivate();
    event.currentTarget.blur();
  };

  return (
    <label
      className={[
        "offer-editor-field",
        className,
        activation.isEditing ? "is-editing" : "requires-double-click",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span>{label}</span>
      <input
        ref={activation.ref}
        value={value}
        disabled={!field.enabled}
        inputMode={isValueField(field) ? "numeric" : "text"}
        readOnly={!activation.isEditing}
        title="Clique duas vezes para editar"
        onBlur={(event) => {
          if (skipNextBlurCommitRef.current) {
            skipNextBlurCommitRef.current = false;
          } else {
            commitValue(event.currentTarget.value);
          }

          activation.deactivate();
        }}
        onChange={(event) =>
          setValue(getEditableFieldValue(field, event.currentTarget.value))
        }
        onDoubleClick={(event) => {
          editStartValueRef.current = normalizeFieldValue(field, field.value);
          activation.handleDoubleClick(event);
        }}
        onFocus={activation.handleFocus}
        onKeyDown={handleKeyDown}
        onMouseDown={activation.handleMouseDown}
      />
    </label>
  );
};

const OfferOptionControl = ({
  optionGroup,
  className = "",
  showLabel = true,
  onChange,
}: {
  optionGroup: OfferOptionGroup;
  className?: string;
  showLabel?: boolean;
  onChange: (selectedIndex: number) => void;
}) => (
  <label className={["offer-editor-field", className].filter(Boolean).join(" ")}>
    {showLabel ? <span>{optionGroup.label}</span> : null}
    <select
      aria-label={!showLabel ? optionGroup.label : undefined}
      value={optionGroup.selectedIndex >= 0 ? optionGroup.selectedIndex : ""}
      disabled={!optionGroup.enabled}
      onChange={(event) => onChange(Number(event.target.value))}
    >
      {optionGroup.selectedIndex < 0 ? (
        <option value="" disabled>
          -
        </option>
      ) : null}
      {optionGroup.options.map((option, index) => (
        <option value={index} key={option.label + index}>
          {option.label}
        </option>
      ))}
    </select>
  </label>
);

const OfferInstallmentJumpControl = ({
  product,
  className = "",
  onChange,
}: {
  product: OfferProduct;
  className?: string;
  onChange: (target: OfferInstallmentJumpTarget) => void;
}) => {
  const installmentJump = product.mechanic.installmentJump;
  if (!installmentJump) return null;
  const alternateTargetLabel =
    product.mechanic.type.toLowerCase() ===
    "de x por y | x% desconto | leve x pague y"
      ? "Preco"
      : "Preco Parcela";

  return (
    <label
      className={["offer-editor-field", className].filter(Boolean).join(" ")}
    >
      <span>Jump</span>
      <select
        value={installmentJump.selectedTarget}
        disabled={!installmentJump.enabled}
        onChange={(event) =>
          onChange(event.target.value as OfferInstallmentJumpTarget)
        }
      >
        <option value="preco-cheio">Preco Cheio</option>
        <option value="preco-parcela">{alternateTargetLabel}</option>
      </select>
    </label>
  );
};

const getOptionControlClassName = (optionGroup: OfferOptionGroup): string =>
  optionGroup.id === "cardKind"
    ? "offer-extra-field offer-card-kind-field"
    : "offer-extra-field";

const ProductEditor = ({
  isRnProject,
  offerLayerIndex,
  product,
  previewRevision,
  onDescriptionChange,
  onDescriptionExpressionChange,
  onFieldChange,
  onOptionChange,
  onInstallmentJumpChange,
  onOpenImagePicker,
  draggedProduct,
  onProductDragEnd,
  onProductDragStart,
  onSwapProducts,
}: ProductEditorProps) => {
  const headerOptionGroup = getHeaderOptionGroup(product);
  const controlOptionGroups = getControlOptionGroups(product);
  const hideFullPriceFromField =
    product.mechanic.type.toLowerCase() === "de x por y parcelamento" &&
    headerOptionGroup?.id === "mechanicCondition" &&
    headerOptionGroup.selectedIndex >= 0 &&
    headerOptionGroup.selectedIndex <= 2;
  const isSharedMechanic =
    product.mechanic.type.toLowerCase() ===
    "de x por y | x% desconto | leve x pague y";
  const sharedMechanicSubtype = controlOptionGroups.find(
    (optionGroup) => optionGroup.id === "mechanicSubtype"
  );
  const usesRnCardPriceLayout =
    isRnProject &&
    isSharedMechanic &&
    sharedMechanicSubtype?.selectedIndex === 2;
  const hideSharedMechanicQuantity =
    isSharedMechanic &&
    (usesRnCardPriceLayout ||
      (headerOptionGroup?.id === "mechanicType" &&
        headerOptionGroup.selectedIndex !== 2 &&
        headerOptionGroup.selectedIndex !== 4));
  const priceFields = getPriceFields(product).filter(
    ({ field }) =>
      (!hideFullPriceFromField || field.id !== "preco-de") &&
      (!usesRnCardPriceLayout || field.id === "preco-de")
  );
  const extraFields = getExtraFields(product).filter(
    ({ field }) =>
      (!isSharedMechanic ||
        field.id !== "por-centagem-desconto" ||
        usesRnCardPriceLayout) &&
      (!hideSharedMechanicQuantity || field.id !== "quantidade-x")
  );
  const [isDragOver, setIsDragOver] = useState(false);
  const isCurrentQuantityField = (field: OfferTextField) =>
    isQuantityXField(field) ||
    (product.mechanic.type.toLowerCase() === "de x por y parcelamento" &&
      isInstallmentsField(field));
  const quantityFieldEntry = extraFields.find(({ field }) =>
    isCurrentQuantityField(field)
  );
  const discountFieldEntry = extraFields.find(
    ({ field }) => field.id === "por-centagem-desconto"
  );
  const inlineValueFieldEntry = usesRnCardPriceLayout
    ? discountFieldEntry
    : quantityFieldEntry;
  const extraFieldsWithoutInlineValue = extraFields.filter(
    ({ field }) => field.id !== inlineValueFieldEntry?.field.id
  );
  const skuName = getOfferSkuName(product);
  const descriptionRows = getOfferDescriptionRows(product.description.value);
  const descriptionHasExpression = product.description.hasExpression === true;
  const descriptionExpressionEnabled =
    product.description.expressionEnabled === true;
  const descriptionActivation =
    useDoubleClickActivation<HTMLTextAreaElement>(
      product.description.enabled
    );
  const skipNextDescriptionBlurCommitRef = useRef(false);
  const descriptionEditStartValueRef = useRef(
    toOfferDescriptionText(product.description.value)
  );
  const hasInstallmentJump = product.mechanic.installmentJump !== undefined &&
    product.mechanic.installmentJump !== null;
  const placeInstallmentJumpWithQuantity =
    hasInstallmentJump &&
    product.mechanic.type.toLowerCase() === "de x por y parcelamento" &&
    !hideFullPriceFromField;
  const useSharedMechanicControlsLayout = isSharedMechanic;
  const useAllPercentDiscountControlsLayout =
    product.mechanic.type.toLowerCase() === "todos a com x% desconto";
  const useAllTakePayControlsLayout =
    product.mechanic.type.toLowerCase() === "todos a leve x pague y";
  const hasExtraControls =
    extraFields.length > 0 ||
    controlOptionGroups.length > 0 ||
    hasInstallmentJump;
  const hasControls =
    priceFields.length > 0 || hasExtraControls || product.unsupported;
  const useSimpleControlsLayout =
    product.mechanic.type.toLowerCase() === "simples" &&
    priceFields.length === 1 &&
    extraFields.length === 0 &&
    controlOptionGroups.length === 1;
  const useInlineValueControlsLayout = usesRnCardPriceLayout
    ? priceFields.length === 1 && discountFieldEntry !== undefined
    : priceFields.length >= 2 && quantityFieldEntry !== undefined;
  const hasInlineValueSecondaryControls =
    extraFieldsWithoutInlineValue.length > 0 ||
    controlOptionGroups.length > 0 ||
    (hasInstallmentJump && !placeInstallmentJumpWithQuantity);
  const canDropDraggedProduct =
    draggedProduct !== null &&
    draggedProduct.offerLayerIndex === offerLayerIndex &&
    draggedProduct.productIndex !== product.index;

  return (
    <article
      className={[
        getOfferProductClassName(product),
        isDragOver ? "is-drop-target" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onDragEnter={(event) => {
        if (!canDropDraggedProduct) return;

        event.preventDefault();
        setIsDragOver(true);
      }}
      onDragOver={(event) => {
        if (!canDropDraggedProduct) return;

        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setIsDragOver(true);
      }}
      onDragLeave={(event) => {
        const nextElement = event.relatedTarget;

        if (
          nextElement instanceof Node &&
          event.currentTarget.contains(nextElement)
        ) {
          return;
        }

        setIsDragOver(false);
      }}
      onDrop={(event) => {
        const droppedProduct =
          draggedProduct || readDraggedOfferProduct(event);

        setIsDragOver(false);

        if (
          droppedProduct === null ||
          droppedProduct.offerLayerIndex !== offerLayerIndex ||
          droppedProduct.productIndex === product.index
        ) {
          return;
        }

        event.preventDefault();
        onSwapProducts(
          offerLayerIndex,
          droppedProduct.productIndex,
          product.index,
          event.shiftKey
        );
        onProductDragEnd();
      }}
    >
      <button
        type="button"
        className="offer-drag-handle"
        draggable
        aria-label="Arrastar produto"
        title="Arrastar produto"
        onClick={(event) => event.preventDefault()}
        onDragEnd={() => {
          setIsDragOver(false);
          onProductDragEnd();
        }}
        onDragStart={(event) => {
          const payload = {
            offerLayerIndex,
            productIndex: product.index,
          };

          clearDocumentSelection();
          onProductDragStart(payload);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(
            OFFER_PRODUCT_DRAG_MIME,
            serializeDraggedOfferProduct(payload)
          );
        }}
        onMouseDown={clearDocumentSelection}
      />

      <header className="offer-product-header">
        {headerOptionGroup ? (
          <OfferOptionControl
            optionGroup={headerOptionGroup}
            className="offer-product-mechanic-selector"
            showLabel={false}
            onChange={(selectedIndex) =>
              onOptionChange(
                offerLayerIndex,
                product.index,
                headerOptionGroup.id,
                selectedIndex
              )
            }
          />
        ) : (
          <span
            className="offer-product-mechanic"
            title={product.mechanic.type}
          >
            {product.mechanic.type}
          </span>
        )}
      </header>

      <div className="offer-product-summary">
        <OfferImageThumbnail
          image={product.image}
          previewRevision={previewRevision}
          skuName={skuName}
          onDoubleClick={() => onOpenImagePicker(product.index)}
        />

        <div className="offer-product-copy">
          <textarea
            ref={descriptionActivation.ref}
            className={[
              "offer-card-description",
              descriptionActivation.isEditing
                ? "is-editing"
                : "requires-double-click",
            ].join(" ")}
            key={toOfferDescriptionText(product.description.value)}
            defaultValue={toOfferDescriptionText(product.description.value)}
            disabled={!product.description.enabled}
            aria-label={product.description.label}
            spellCheck={false}
            readOnly={!descriptionActivation.isEditing}
            rows={descriptionRows}
            title="Clique duas vezes para editar"
            onBlur={(event) => {
              if (skipNextDescriptionBlurCommitRef.current) {
                skipNextDescriptionBlurCommitRef.current = false;
              } else {
                commitDescriptionTextArea(
                  product.description.value,
                  (value) =>
                    onDescriptionChange(offerLayerIndex, product.index, value)
                )(event);
              }

              descriptionActivation.deactivate();
            }}
            onDoubleClick={(event) => {
              descriptionEditStartValueRef.current = toOfferDescriptionText(
                product.description.value
              );
              descriptionActivation.handleDoubleClick(event);
            }}
            onFocus={descriptionActivation.handleFocus}
            onKeyDown={(event) => {
              if (isUndoKey(event) && descriptionActivation.isEditing) {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.value = descriptionEditStartValueRef.current;
                return;
              }

              if (event.key !== "Tab" || !descriptionActivation.isEditing) {
                return;
              }

              commitDescriptionTextArea(
                product.description.value,
                (value) =>
                  onDescriptionChange(offerLayerIndex, product.index, value)
              )(event as unknown as FocusEvent<HTMLTextAreaElement>);
              skipNextDescriptionBlurCommitRef.current = true;
              descriptionActivation.activateNextFocus();
              descriptionActivation.deactivate();
            }}
            onMouseDown={descriptionActivation.handleMouseDown}
          />

          <label
            className="offer-description-sync"
            title={
              descriptionHasExpression
                ? "Habilitar ou desabilitar a expressão do descritivo"
                : "O Source Text do descritivo não possui expressão"
            }
          >
            <input
              type="checkbox"
              checked={descriptionExpressionEnabled}
              disabled={!descriptionHasExpression}
              onChange={(event) =>
                onDescriptionExpressionChange(
                  offerLayerIndex,
                  product.index,
                  event.currentTarget.checked
                )
              }
            />
            <span>Expressão Descritivo</span>
          </label>
        </div>
      </div>

      {hasControls ? (
        <div className="offer-product-controls">
          {useSimpleControlsLayout ? (
            <div className="offer-simple-controls">
              {priceFields.map(({ field, fieldIndex }) => (
                <OfferFieldControl
                  field={field}
                  key={field.id}
                  className={getFieldClassName(field, "offer-price-field")}
                  onCommit={(value) =>
                    onFieldChange(
                      offerLayerIndex,
                      product.index,
                      field.id,
                      value,
                      fieldIndex
                    )
                  }
                />
              ))}

              {controlOptionGroups.map((optionGroup) => (
                <OfferOptionControl
                  optionGroup={optionGroup}
                  key={optionGroup.id}
                  className={getOptionControlClassName(optionGroup)}
                  onChange={(selectedIndex) =>
                    onOptionChange(
                      offerLayerIndex,
                      product.index,
                      optionGroup.id,
                      selectedIndex
                    )
                  }
                />
              ))}
            </div>
          ) : useInlineValueControlsLayout && inlineValueFieldEntry ? (
            <div className="offer-quantity-controls">
              <div
                className={[
                  "offer-quantity-values",
                  placeInstallmentJumpWithQuantity
                    ? "has-inline-installment-jump"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {priceFields.map(({ field, fieldIndex }) => (
                  <OfferFieldControl
                    field={field}
                    key={field.id}
                    className={getFieldClassName(field, "offer-price-field")}
                    onCommit={(value) =>
                      onFieldChange(
                        offerLayerIndex,
                        product.index,
                        field.id,
                        value,
                        fieldIndex
                      )
                    }
                  />
                ))}

                <OfferFieldControl
                  field={inlineValueFieldEntry.field}
                  key={inlineValueFieldEntry.field.id}
                  className={getFieldClassName(
                    inlineValueFieldEntry.field,
                    usesRnCardPriceLayout
                      ? "offer-extra-field"
                      : "offer-extra-field offer-quantity-field"
                  )}
                  onCommit={(value) =>
                    onFieldChange(
                      offerLayerIndex,
                      product.index,
                      inlineValueFieldEntry.field.id,
                      value,
                      inlineValueFieldEntry.fieldIndex
                    )
                  }
                />

                {placeInstallmentJumpWithQuantity ? (
                  <OfferInstallmentJumpControl
                    product={product}
                    className="offer-extra-field offer-installment-jump-field offer-inline-installment-jump-field"
                    onChange={(target) =>
                      onInstallmentJumpChange(
                        offerLayerIndex,
                        product.index,
                        target
                      )
                    }
                  />
                ) : null}
              </div>

              {hasInlineValueSecondaryControls ? (
                <div
                  className={[
                    "offer-quantity-options",
                    product.mechanic.installmentJump
                      ? "has-installment-jump"
                      : "",
                    useSharedMechanicControlsLayout
                      ? "is-shared-mechanic"
                      : "",
                    product.mechanic.installmentJump &&
                    extraFieldsWithoutInlineValue.length === 0 &&
                    controlOptionGroups.length === 0
                      ? "has-only-installment-jump"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {extraFieldsWithoutInlineValue.map(({ field, fieldIndex }) => (
                    <OfferFieldControl
                      field={field}
                      key={field.id}
                      className={getFieldClassName(field, "offer-extra-field")}
                      onCommit={(value) =>
                        onFieldChange(
                          offerLayerIndex,
                          product.index,
                          field.id,
                          value,
                          fieldIndex
                        )
                      }
                    />
                  ))}

                  {controlOptionGroups.map((optionGroup) => (
                    <OfferOptionControl
                      optionGroup={optionGroup}
                      key={optionGroup.id}
                      className={getOptionControlClassName(optionGroup)}
                      onChange={(selectedIndex) =>
                        onOptionChange(
                          offerLayerIndex,
                          product.index,
                          optionGroup.id,
                          selectedIndex
                        )
                      }
                    />
                  ))}

                  {product.mechanic.installmentJump &&
                  !placeInstallmentJumpWithQuantity ? (
                    <OfferInstallmentJumpControl
                      product={product}
                      className="offer-extra-field offer-installment-jump-field"
                      onChange={(target) =>
                        onInstallmentJumpChange(
                          offerLayerIndex,
                          product.index,
                          target
                        )
                      }
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <>
              {priceFields.length > 0 ? (
                <div
                  className={[
                    "offer-price-row",
                    priceFields.length === 1 ? "has-single-price" : "",
                    isSharedMechanic
                      ? "offer-shared-mechanic-price-row"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {priceFields.map(({ field, fieldIndex }) => (
                    <OfferFieldControl
                      field={field}
                      key={field.id}
                      className={getFieldClassName(field, "offer-price-field")}
                      onCommit={(value) =>
                        onFieldChange(
                          offerLayerIndex,
                          product.index,
                          field.id,
                          value,
                          fieldIndex
                        )
                      }
                    />
                  ))}
                </div>
              ) : null}

              {hasExtraControls ? (
                <div
                  className={[
                    "offer-extra-controls",
                    useSharedMechanicControlsLayout
                      ? "offer-shared-mechanic-controls"
                      : "",
                    useAllPercentDiscountControlsLayout
                      ? "offer-all-percent-discount-controls"
                      : "",
                    useAllTakePayControlsLayout
                      ? "offer-all-take-pay-controls"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {extraFields.map(({ field, fieldIndex }) => (
                    <OfferFieldControl
                      field={field}
                      key={field.id}
                      className={getFieldClassName(
                        field,
                        isQuantityXField(field)
                          ? "offer-extra-field offer-quantity-field"
                          : "offer-extra-field"
                      )}
                      onCommit={(value) =>
                        onFieldChange(
                          offerLayerIndex,
                          product.index,
                          field.id,
                          value,
                          fieldIndex
                        )
                      }
                    />
                  ))}

                  {controlOptionGroups.map((optionGroup) => (
                    <OfferOptionControl
                      optionGroup={optionGroup}
                      key={optionGroup.id}
                      className={getOptionControlClassName(optionGroup)}
                      onChange={(selectedIndex) =>
                        onOptionChange(
                          offerLayerIndex,
                          product.index,
                          optionGroup.id,
                          selectedIndex
                        )
                      }
                    />
                  ))}

                  {product.mechanic.installmentJump ? (
                    <OfferInstallmentJumpControl
                      product={product}
                      className="offer-extra-field offer-installment-jump-field"
                      onChange={(target) =>
                        onInstallmentJumpChange(
                          offerLayerIndex,
                          product.index,
                          target
                        )
                      }
                    />
                  ) : null}
                </div>
              ) : null}
            </>
          )}

          {product.unsupported ? (
            <p className="offer-warning">{product.mechanic.type}</p>
          ) : null}
        </div>
      ) : null}

    </article>
  );
};

const OfferLegalTextPreview = ({
  legalText,
}: {
  legalText: OfferTextField;
}) => (
  <section className="offer-legal-preview" aria-label={legalText.label}>
    <span>{legalText.label}</span>
    <div>{legalText.value}</div>
  </section>
);

const OfferLegalControlToggle = ({
  control,
  offerLayerIndex,
  onControlChange,
  onControlOptionChange,
  onControlValueChange,
}: {
  control: OfferLegalControl;
  offerLayerIndex: number;
  onControlChange: OfferLegalSettingsProps["onControlChange"];
  onControlOptionChange: OfferLegalSettingsProps["onControlOptionChange"];
  onControlValueChange: OfferLegalSettingsProps["onControlValueChange"];
}) => {
  const [checked, setChecked] = useState(control.enabled);

  useEffect(() => {
    setChecked(control.enabled);
  }, [control.enabled, control.id]);

  return (
    <div
      className={[
        "offer-legal-toggle",
        control.available ? "" : "is-disabled",
        control.locked ? "is-locked" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      title={"Layer " + control.layerIndex}
    >
      <div className="offer-legal-toggle-main">
        {control.locked ? (
          <span className="offer-legal-fixed-indicator">Fixo</span>
        ) : (
          <input
            type="checkbox"
            checked={checked}
            disabled={!control.available}
            onChange={(event) => {
              const nextChecked = event.currentTarget.checked;

              setChecked(nextChecked);
              onControlChange(offerLayerIndex, control.id, nextChecked);
            }}
          />
        )}
        <span>{control.label}</span>
      </div>

      {control.slider ? (
        <OfferLegalSliderInput
          controlId={control.id}
          field={control.slider}
          offerLayerIndex={offerLayerIndex}
          onCommit={onControlValueChange}
        />
      ) : null}

      {control.optionGroup ? (
        <select
          className="offer-legal-select"
          value={
            control.optionGroup.selectedIndex >= 0
              ? control.optionGroup.selectedIndex
              : ""
          }
          disabled={!control.optionGroup.enabled}
          onChange={(event) =>
            onControlOptionChange(
              offerLayerIndex,
              control.id,
              Number(event.currentTarget.value)
            )
          }
        >
          {control.optionGroup.selectedIndex < 0 ? (
            <option value="" disabled>
              -
            </option>
          ) : null}
          {control.optionGroup.options.map((option, index) => (
            <option value={index} key={option.label + index}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
};

const OfferLegalSliderInput = ({
  controlId,
  field,
  offerLayerIndex,
  onCommit,
}: {
  controlId: string;
  field: OfferTextField;
  offerLayerIndex: number;
  onCommit: OfferLegalSettingsProps["onControlValueChange"];
}) => {
  const [value, setValue] = useState(String(field.value || "").replace(",", "."));
  const lastCommittedValueRef = useRef(String(field.value || "").replace(",", "."));
  const commitTimerRef = useRef(0);

  useEffect(() => {
    const nextValue = String(field.value || "").replace(",", ".");

    window.clearTimeout(commitTimerRef.current);
    setValue(nextValue);
    lastCommittedValueRef.current = nextValue;
  }, [field.value]);

  useEffect(
    () => () => {
      window.clearTimeout(commitTimerRef.current);
    },
    []
  );

  const commitValue = (nextValue: string) => {
    if (nextValue === "" || nextValue === lastCommittedValueRef.current) {
      return;
    }

    lastCommittedValueRef.current = nextValue;
    onCommit(offerLayerIndex, controlId, nextValue);
  };

  const scheduleCommit = (nextValue: string) => {
    window.clearTimeout(commitTimerRef.current);

    commitTimerRef.current = window.setTimeout(() => {
      commitValue(nextValue);
    }, 220);
  };

  return (
    <input
      className="offer-legal-slider-input"
      type="number"
      step="1"
      value={value}
      disabled={!field.enabled}
      onBlur={(event) => {
        window.clearTimeout(commitTimerRef.current);
        commitValue(event.currentTarget.value);
      }}
      onChange={(event) => {
        const nextValue = keepDigits(event.currentTarget.value);

        setValue(nextValue);
        scheduleCommit(nextValue);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;

        event.preventDefault();
        window.clearTimeout(commitTimerRef.current);
        commitValue(event.currentTarget.value);
        event.currentTarget.blur();
      }}
    />
  );
};

const OfferLegalSettingsDialog = ({
  controls,
  legalText,
  offerLayerIndex,
  onClose,
  onControlChange,
  onControlOptionChange,
  onControlValueChange,
}: OfferLegalSettingsProps) => {
  const titleId = "offer-legal-settings-title-" + offerLayerIndex;

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="offer-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="offer-legal-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="offer-legal-settings-header">
          <h3 id={titleId}>Configuracao da Oferta</h3>
          <button type="button" onClick={onClose}>
            Fechar
          </button>
        </header>

        <div className="offer-legal-settings-content">
          {legalText ? (
            <OfferLegalTextPreview legalText={legalText} />
          ) : (
            <p className="offer-legal-empty">Texto legal nao encontrado.</p>
          )}

          <div className="offers-legal-controls" aria-label="Camadas">
            <span className="offers-legal-controls-title">
              Camadas do texto legal
            </span>
            {controls.map((control) => (
              <OfferLegalControlToggle
                control={control}
                offerLayerIndex={offerLayerIndex}
                key={control.id}
                onControlChange={onControlChange}
                onControlOptionChange={onControlOptionChange}
                onControlValueChange={onControlValueChange}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

const OfferProductImagePicker = ({
  images,
  onClose,
  onImageError,
  onLoadPreview,
  onSelectImage,
}: {
  images: LocalImage[];
  onClose: () => void;
  onImageError: (image: LocalImage) => void;
  onLoadPreview: (image: LocalImage) => Promise<void>;
  onSelectImage: (image: LocalImage, openOfferPrecomp: boolean) => void;
}) => {
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const titleId = "offer-image-picker-title";
  const visibleImages = images.filter((image) =>
    image.name.toLowerCase().includes(query.trim().toLowerCase())
  );

  useEffect(() => {
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const isLoading = visibleImages.some(
      (image) => image.previewStatus === "loading"
    );

    if (isLoading) return;

    const nextImage = visibleImages.find(
      (image) => image.previewStatus === "idle"
    );

    if (nextImage) {
      void onLoadPreview(nextImage);
    }
  }, [onLoadPreview, visibleImages]);

  return (
    <div
      className="offer-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="offer-image-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="offer-image-picker-header">
          <h3 id={titleId}>Selecionar produto</h3>
          <button type="button" onClick={onClose}>
            Fechar
          </button>
        </header>

        <input
          ref={searchInputRef}
          className="offer-image-picker-search"
          aria-label="Buscar produto"
          placeholder="Buscar"
          value={query}
          spellCheck={false}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />

        <div className="offer-image-picker-list">
          {visibleImages.length === 0 ? (
            <div className="offer-image-picker-empty">
              Nenhum produto encontrado.
            </div>
          ) : (
            visibleImages.map((image) => (
              <button
                type="button"
                className="offer-image-picker-item"
                key={image.fullPath}
                title={image.name}
                onClick={(event) => onSelectImage(image, event.shiftKey)}
                onMouseEnter={() => {
                  if (image.previewStatus === "idle") {
                    void onLoadPreview(image);
                  }
                }}
              >
                <span className="offer-image-picker-thumb">
                  {image.previewUrl ? (
                    <img
                      src={image.previewUrl}
                      alt=""
                      loading="lazy"
                      onError={() => onImageError(image)}
                    />
                  ) : image.previewStatus === "loading" ? (
                    <span className="thumb-loader" />
                  ) : (
                    <span>{image.extension.replace(".", "").toUpperCase()}</span>
                  )}
                </span>
                <span className="offer-image-picker-name">{image.name}</span>
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
};

export const OffersPanel = ({
  projectName,
  productImages,
  requestedOfferLayerIndex,
  onLoadProductPreview,
  onRefreshProductImages,
  onBeforeOfferNavigation,
  onRequestedOfferLayerIndexHandled,
  onStatus,
}: OffersPanelProps) => {
  const isRnProject = isRnAfterProject(projectName);
  const [draggedProduct, setDraggedProduct] =
    useState<DraggedOfferProduct | null>(null);
  const [draggedOfferTab, setDraggedOfferTab] =
    useState<DraggedOfferTab | null>(null);
  const [offerDropTargetLayerIndex, setOfferDropTargetLayerIndex] =
    useState<number | null>(null);
  const [dragReadyOfferLayerIndex, setDragReadyOfferLayerIndex] =
    useState<number | null>(null);
  const offerClickTimerRef = useRef(0);
  const offerTabHoldTimerRef = useRef(0);
  const offerTabClickReleaseTimerRef = useRef(0);
  const suppressOfferTabClickRef = useRef(false);
  const [isLegalSettingsOpen, setIsLegalSettingsOpen] = useState(false);
  const [imagePickerTarget, setImagePickerTarget] =
    useState<ImagePickerTarget | null>(null);
  const [previewRevision, setPreviewRevision] = useState(0);
  const {
    snapshot,
    loading,
    refreshOffers,
    selectOffer,
    openOfferPrecomp,
    updateDescription,
    updateDescriptionExpression,
    updateField,
    updateOption,
    updateInstallmentJump,
    updateLegalControl,
    updateLegalControlValue,
    updateLegalControlOption,
    replaceProductImage,
    swapOffers,
    swapProducts,
    undo,
  } = useOffersEditor({
    initialOfferLayerIndex: requestedOfferLayerIndex,
    onStatus,
  });
  const selectedOffer = snapshot?.selectedOffer ?? null;

  const handleUndo = useCallback(async () => {
    const offersRefreshed = await undo();
    if (!offersRefreshed) return;

    await onRefreshProductImages?.();
    setPreviewRevision((current) => current + 1);
  }, [onRefreshProductImages, undo]);

  useOfferShortcuts({
    onStatus,
    onUndo: handleUndo,
  });

  useEffect(() => {
    if (typeof requestedOfferLayerIndex !== "number") return;
    onRequestedOfferLayerIndexHandled?.();
  }, [onRequestedOfferLayerIndexHandled, requestedOfferLayerIndex]);

  useEffect(() => {
    const releaseOfferTabHold = () => {
      window.clearTimeout(offerTabHoldTimerRef.current);
      offerTabHoldTimerRef.current = 0;
      setDragReadyOfferLayerIndex(null);
    };

    window.addEventListener("mouseup", releaseOfferTabHold);

    return () => {
      window.removeEventListener("mouseup", releaseOfferTabHold);
      window.clearTimeout(offerClickTimerRef.current);
      window.clearTimeout(offerTabHoldTimerRef.current);
      window.clearTimeout(offerTabClickReleaseTimerRef.current);
    };
  }, []);

  const handlePanelKeyDownCapture = (event: KeyboardEvent<HTMLElement>) => {
    if (!isUndoKey(event)) return;
    if (isEditableOfferTextControl(event.target)) return;

    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
    if (event.repeat) return;

    void handleUndo();
  };

  const handleRefreshOffers = async () => {
    if (loading) return;

    const refreshed = await refreshOffers();
    await onRefreshProductImages?.();
    setPreviewRevision((current) => current + 1);

    if (refreshed) {
      onStatus("Ofertas atualizadas.");
    }
  };

  const runOfferNavigation = (action: () => Promise<void>) => {
    void (async () => {
      if (onBeforeOfferNavigation && !(await onBeforeOfferNavigation())) {
        return;
      }

      await action();
    })();
  };

  return (
    <section
      className="offers-panel"
      aria-label="Ofertas"
      onKeyDownCapture={handlePanelKeyDownCapture}
    >
      <aside className="offers-sidebar">
        <div className="offers-list">
          {snapshot?.offers.map((offer, index) => {
            const isSelected = offer.layerIndex === snapshot.selectedOfferLayerIndex;
            const isDragging =
              offer.layerIndex === draggedOfferTab?.offerLayerIndex;
            const isDropTarget =
              offer.layerIndex === offerDropTargetLayerIndex;
            const isDragReady =
              offer.layerIndex === dragReadyOfferLayerIndex;
            const offerColor = getOfferTabColor(offer.markerIndex, index);
            const offerTabName = getOfferTabName(index);
            const offerTabFullName = getOfferTabFullName(index);
            const offerTabStyle = {
              "--offer-tab-color": offerColor,
            } as CSSProperties;

            return (
              <button
                type="button"
                key={offer.layerIndex}
                title={offer.name}
                aria-label={offerTabFullName + " - " + offer.name}
                className={[
                  isSelected ? "is-selected" : "",
                  isDragging ? "is-dragging" : "",
                  isDragReady ? "is-drag-ready" : "",
                  isDropTarget ? "is-drop-target" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={offerTabStyle}
                draggable={isDragReady}
                onMouseDown={(event) => {
                  if (event.button !== 0) return;

                  window.clearTimeout(offerClickTimerRef.current);
                  window.clearTimeout(offerTabHoldTimerRef.current);
                  setDragReadyOfferLayerIndex(null);
                  offerTabHoldTimerRef.current = window.setTimeout(() => {
                    offerTabHoldTimerRef.current = 0;
                    setDragReadyOfferLayerIndex(offer.layerIndex);
                  }, OFFER_TAB_DRAG_HOLD_MS);
                }}
                onMouseLeave={() => {
                  if (isDragReady || isDragging) return;

                  window.clearTimeout(offerTabHoldTimerRef.current);
                  offerTabHoldTimerRef.current = 0;
                }}
                onClick={() => {
                  if (suppressOfferTabClickRef.current) {
                    window.clearTimeout(offerTabClickReleaseTimerRef.current);
                    offerTabClickReleaseTimerRef.current = 0;
                    suppressOfferTabClickRef.current = false;
                    return;
                  }

                  window.clearTimeout(offerClickTimerRef.current);
                  offerClickTimerRef.current = window.setTimeout(() => {
                    offerClickTimerRef.current = 0;
                    runOfferNavigation(() => selectOffer(offer.layerIndex));
                  }, 180);
                }}
                onDoubleClick={() => {
                  window.clearTimeout(offerClickTimerRef.current);
                  offerClickTimerRef.current = 0;
                  runOfferNavigation(() =>
                    openOfferPrecomp(offer.layerIndex)
                  );
                }}
                onDragStart={(event) => {
                  if (!isDragReady) {
                    event.preventDefault();
                    return;
                  }

                  window.clearTimeout(offerClickTimerRef.current);
                  offerClickTimerRef.current = 0;
                  window.clearTimeout(offerTabHoldTimerRef.current);
                  window.clearTimeout(offerTabClickReleaseTimerRef.current);
                  offerTabHoldTimerRef.current = 0;
                  offerTabClickReleaseTimerRef.current = 0;
                  suppressOfferTabClickRef.current = true;
                  setDraggedOfferTab({ offerLayerIndex: offer.layerIndex });
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(
                    OFFER_TAB_DRAG_MIME,
                    String(offer.layerIndex)
                  );
                }}
                onDragEnter={(event) => {
                  if (
                    draggedOfferTab !== null &&
                    draggedOfferTab.offerLayerIndex !== offer.layerIndex
                  ) {
                    event.preventDefault();
                    setOfferDropTargetLayerIndex(offer.layerIndex);
                  }
                }}
                onDragOver={(event) => {
                  if (
                    draggedOfferTab !== null &&
                    draggedOfferTab.offerLayerIndex !== offer.layerIndex
                  ) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }
                }}
                onDragLeave={(event) => {
                  const relatedTarget = event.relatedTarget;
                  if (
                    !(relatedTarget instanceof Node) ||
                    !event.currentTarget.contains(relatedTarget)
                  ) {
                    setOfferDropTargetLayerIndex(null);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const dragged =
                    draggedOfferTab || readDraggedOfferTab(event);

                  setDraggedOfferTab(null);
                  setOfferDropTargetLayerIndex(null);

                  if (
                    dragged === null ||
                    dragged.offerLayerIndex === offer.layerIndex
                  ) {
                    return;
                  }

                  runOfferNavigation(() =>
                    swapOffers(dragged.offerLayerIndex, offer.layerIndex)
                  );
                }}
                onDragEnd={() => {
                  window.clearTimeout(offerTabHoldTimerRef.current);
                  offerTabHoldTimerRef.current = 0;
                  setDraggedOfferTab(null);
                  setDragReadyOfferLayerIndex(null);
                  setOfferDropTargetLayerIndex(null);
                  window.clearTimeout(offerTabClickReleaseTimerRef.current);
                  offerTabClickReleaseTimerRef.current = window.setTimeout(
                    () => {
                      offerTabClickReleaseTimerRef.current = 0;
                      suppressOfferTabClickRef.current = false;
                    },
                    OFFER_TAB_POST_DRAG_CLICK_SUPPRESSION_MS
                  );
                }}
              >
                <span className="offer-tab-color" aria-hidden="true" />
                <span className="offer-tab-name offer-tab-name-short">
                  {offerTabName}
                </span>
                <span className="offer-tab-name offer-tab-name-full">
                  {offerTabFullName}
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="offers-editor">
        {selectedOffer ? (
          <>
            <header className="offers-editor-header">
              <strong>{selectedOffer.name}</strong>
              <div className="offers-editor-meta">
                <span>{snapshot?.compName}</span>
                <button
                  type="button"
                  className="offers-refresh-button"
                  aria-label="Atualizar ofertas"
                  aria-busy={loading}
                  disabled={loading}
                  title="Atualizar ofertas e imagens"
                  onClick={() => void handleRefreshOffers()}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    clearDocumentSelection();
                  }}
                >
                  {loading ? "..." : "↺"}
                </button>
                <button
                  type="button"
                  className="offers-legal-menu-button"
                  aria-label="Opcoes do texto legal"
                  title="Opcoes do texto legal"
                  onClick={() => setIsLegalSettingsOpen(true)}
                  onMouseDown={clearDocumentSelection}
                >
                  <span aria-hidden="true" />
                </button>
              </div>
            </header>

            <div className="offer-products">
              {selectedOffer.products.map((product) => (
                <ProductEditor
                  isRnProject={isRnProject}
                  offerLayerIndex={selectedOffer.layerIndex}
                  product={product}
                  previewRevision={previewRevision}
                  draggedProduct={draggedProduct}
                  key={product.index}
                  onDescriptionChange={updateDescription}
                  onDescriptionExpressionChange={updateDescriptionExpression}
                  onFieldChange={updateField}
                  onOptionChange={updateOption}
                  onInstallmentJumpChange={updateInstallmentJump}
                  onOpenImagePicker={(productIndex) =>
                    setImagePickerTarget({
                      offerLayerIndex: selectedOffer.layerIndex,
                      productIndex,
                    })
                  }
                  onProductDragEnd={() => setDraggedProduct(null)}
                  onProductDragStart={setDraggedProduct}
                  onSwapProducts={swapProducts}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="offers-empty">
            {snapshot?.message
              ? getPublicErrorMessage(
                  snapshot.message,
                  snapshot.ok
                    ? "Nenhuma oferta foi encontrada neste projeto."
                    : "Não foi possível carregar as ofertas deste projeto.",
                )
              : "Carregando ofertas..."}
          </div>
        )}
      </main>

      {selectedOffer && isLegalSettingsOpen ? (
        <OfferLegalSettingsDialog
          controls={selectedOffer.legalControls}
          legalText={selectedOffer.legalText}
          offerLayerIndex={selectedOffer.layerIndex}
          onClose={() => setIsLegalSettingsOpen(false)}
          onControlChange={updateLegalControl}
          onControlOptionChange={updateLegalControlOption}
          onControlValueChange={updateLegalControlValue}
        />
      ) : null}

      {imagePickerTarget ? (
        <OfferProductImagePicker
          images={productImages}
          onClose={() => setImagePickerTarget(null)}
          onImageError={(image) =>
            onStatus("Nao foi possivel carregar " + image.name + ".")
          }
          onLoadPreview={onLoadProductPreview}
          onSelectImage={(image, openOfferPrecomp) => {
            void replaceProductImage(
              imagePickerTarget.offerLayerIndex,
              imagePickerTarget.productIndex,
              image.fullPath,
              openOfferPrecomp
            );
            setImagePickerTarget(null);
          }}
        />
      ) : null}
    </section>
  );
};
