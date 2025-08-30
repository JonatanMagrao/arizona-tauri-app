- adicionar `"core:webview:allow-create-webview-window"` no `default.json` em permissions
- eu criei um jsx em panels chamado `ProductLog.jsx` e um `main-product-log.jsx`. ambos posso criar em uma pasta chamada windowsem src para armazenar segundas janelas
- criar um html no mesmo nível do index.html (ex: `product-log.html`)
- linkar `main-product-log.jsx` no `product-log.html`
- adicionar `import { WebviewWindow } from "@tauri-apps/api/webviewWindow"` no `App.jsx` 
- ainda no `App.jsx`, criar uma função como 
```js
const openProductLog = () => {
    new WebviewWindow("product-log", {
      url: "product-log.html", // vai carregar o HTML que criamos no public/
      title: "Product Log",
      width: 800,
      height: 400,
      center: true,
    });
  };
```