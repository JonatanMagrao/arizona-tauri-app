const keepDigits = (value: string) => {
  let output = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value.charAt(index);

    if (character >= "0" && character <= "9") {
      output += character;
    }
  }

  return output;
};

const stripLeadingZeroes = (value: string) => {
  const stripped = value.replace(/^0+/, "");

  return stripped === "" ? "0" : stripped;
};

const formatThousands = (value: string) => {
  let output = "";
  let groupSize = 0;

  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (groupSize === 3) {
      output = "." + output;
      groupSize = 0;
    }

    output = value.charAt(index) + output;
    groupSize += 1;
  }

  return output;
};

export const normalizeOfferPrice = (value: string) => {
  const text = String(value || "").trim();
  const separatorIndex = getDecimalSeparatorIndex(text);

  if (separatorIndex >= 0) {
    const rawIntegerPart = text.substring(0, separatorIndex);
    const rawDecimalPart = text.substring(separatorIndex + 1);
    const rawIntegerDigits = keepDigits(rawIntegerPart);
    let decimalPart = keepDigits(rawDecimalPart);

    if (rawIntegerDigits === "" && decimalPart === "") return "";

    while (decimalPart.length < 2) {
      decimalPart += "0";
    }

    if (decimalPart.length > 2) {
      decimalPart = decimalPart.substring(0, 2);
    }

    return (
      formatThousands(stripLeadingZeroes(rawIntegerDigits || "0")) +
      "," +
      decimalPart
    );
  }

  const digits = keepDigits(text);
  if (digits === "") return "";

  const paddedDigits = digits.length < 3 ? digits.padStart(3, "0") : digits;
  const rawIntegerDigits = paddedDigits.substring(0, paddedDigits.length - 2);
  const decimalPart = paddedDigits.substring(paddedDigits.length - 2);
  const integerDigits = stripLeadingZeroes(rawIntegerDigits);

  return formatThousands(integerDigits || "0") + "," + decimalPart;
};

const getDecimalSeparatorIndex = (value: string) => {
  const commaIndex = value.lastIndexOf(",");

  if (commaIndex >= 0) return commaIndex;

  const dotIndex = value.lastIndexOf(".");

  if (dotIndex < 0) return -1;

  const decimalDigits = keepDigits(value.substring(dotIndex + 1));

  return decimalDigits.length > 0 && decimalDigits.length <= 2 ? dotIndex : -1;
};
