using Microsoft.AspNetCore.Antiforgery;

namespace Diversify.Delivery.Core;

/// <summary>Solo para el aviso servidor a servidor de PixelPay, que valida su propia firma.</summary>
public sealed class PixelPayNotificationCsrfExemption;

public class CsrfProtectionMiddleware(RequestDelegate next)
{
    public const string HeaderName = "X-CSRF-TOKEN";

    public static bool IsSameOrigin(HttpRequest request)
    {
        var site = request.Headers["Sec-Fetch-Site"].ToString();
        if (site is "cross-site" or "same-site") return false;
        if (!request.Headers.TryGetValue("Origin", out var origin)) return true; // Clientes sin Origin aún deben presentar token.
        return Uri.TryCreate(origin.ToString(), UriKind.Absolute, out var uri) &&
            Uri.TryCreate($"{request.Scheme}://{request.Host}", UriKind.Absolute, out var target) &&
            uri.UserInfo.Length == 0 && uri.AbsolutePath == "/" && uri.Query.Length == 0 && uri.Fragment.Length == 0 &&
            string.Equals(uri.GetLeftPart(UriPartial.Authority), target.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase);
    }

    public async Task InvokeAsync(HttpContext http, IAntiforgery antiforgery)
    {
        if (!http.Request.Path.StartsWithSegments("/api") || HttpMethods.IsGet(http.Request.Method) ||
            HttpMethods.IsHead(http.Request.Method) || HttpMethods.IsOptions(http.Request.Method) ||
            http.GetEndpoint()?.Metadata.GetMetadata<PixelPayNotificationCsrfExemption>() is not null)
        {
            await next(http);
            return;
        }
        if (IsSameOrigin(http.Request) && !string.IsNullOrEmpty(http.Request.Headers[HeaderName]))
        {
            var valid = false;
            try
            {
                await antiforgery.ValidateRequestAsync(http);
                valid = true;
            }
            catch (AntiforgeryValidationException) { /* No ejecutar el endpoint. */ }
            if (valid) { await next(http); return; }
        }
        http.Response.StatusCode = StatusCodes.Status403Forbidden;
        http.Response.Headers["X-CSRF-Error"] = "1";
        await http.Response.WriteAsJsonAsync(new { error = "La solicitud no pasó la protección CSRF. Recarga la página e inténtalo de nuevo." });
    }
}
