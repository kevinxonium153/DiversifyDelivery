using System.Diagnostics.CodeAnalysis;

namespace Diversify.Delivery.Core;

/// <summary>Error de negocio: se devuelve al cliente como { error: "mensaje" } con el código indicado.</summary>
public class AppException(string message, int statusCode = StatusCodes.Status400BadRequest) : Exception(message)
{
    public int StatusCode { get; } = statusCode;

    public static AppException NotFound(string what) => new($"{what} no encontrado.", StatusCodes.Status404NotFound);

    public static void ThrowIf([DoesNotReturnIf(true)] bool condition, string message)
    {
        if (condition) throw new AppException(message);
    }
}

public class ErrorHandlingMiddleware(RequestDelegate next, ILogger<ErrorHandlingMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await next(context);
        }
        catch (AppException ex)
        {
            await WriteError(context, ex.StatusCode, ex.Message);
        }
        catch (BadHttpRequestException ex)
        {
            await WriteError(context, StatusCodes.Status400BadRequest, "Solicitud inválida: " + ex.Message);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error no controlado en {Path}", context.Request.Path);
            await WriteError(context, StatusCodes.Status500InternalServerError,
                "Ocurrió un error inesperado. Revisa el log del servidor.");
        }
    }

    private static Task WriteError(HttpContext context, int status, string message)
    {
        if (context.Response.HasStarted) return Task.CompletedTask;
        context.Response.StatusCode = status;
        return context.Response.WriteAsJsonAsync(new { error = message });
    }
}
