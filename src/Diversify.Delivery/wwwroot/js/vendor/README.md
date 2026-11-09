# Librerías de terceros (alojadas aquí: la CSP no permite CDNs)

| Archivo | Origen | Versión | Licencia |
|---|---|---|---|
| `pixelpay-sdk.js` | `@pixelpay/sdk-core` (npm), archivo `lib/browser/index.js` | 2.5.10 | MIT (`PIXELPAY-SDK-LICENSE.md`) |

Para actualizar el SDK de PixelPay:

```bash
npm pack @pixelpay/sdk-core@<versión>
tar -xzf pixelpay-sdk-core-<versión>.tgz
cp package/lib/browser/index.js src/Diversify.Delivery/wwwroot/js/vendor/pixelpay-sdk.js
```

Solo se usa en la página de pago (`/pago/`). Define `window.Models`, `window.Requests`, `window.Services`, etc.
