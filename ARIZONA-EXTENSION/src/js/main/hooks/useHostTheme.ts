import { useEffect, useState } from "react";
import { subscribeBackgroundColor } from "../../lib/utils/bolt";

export const useHostTheme = () => {
  const [bgColor, setBgColor] = useState("#282c34");

  useEffect(() => {
    if (window.cep) {
      subscribeBackgroundColor(setBgColor);
    }
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--host-background-color", bgColor);
  }, [bgColor]);

  return bgColor;
};
