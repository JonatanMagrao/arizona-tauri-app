import { useEffect, useState } from "react";
import { subscribeBackgroundColor } from "../../lib/utils/bolt";

export const useHostTheme = () => {
  const [bgColor, setBgColor] = useState("#282c34");

  useEffect(() => {
    if (window.cep) {
      subscribeBackgroundColor(setBgColor);
    }
  }, []);

  return bgColor;
};
