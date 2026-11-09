using Microsoft.EntityFrameworkCore;

namespace Diversify.Delivery.Core;

/// <summary>
/// Cambios de esquema pequeños para bases que ya existen. EnsureCreated no toca una base existente, así que:
/// <list type="bullet">
/// <item>las <b>tablas nuevas</b> (ej. la de un módulo nuevo) se crean solas a partir del modelo de EF, con sus índices;</item>
/// <item>las <b>columnas nuevas</b> de tablas existentes se declaran en <see cref="Columns"/>.</item>
/// </list>
/// Copiado de Diversify POS. Es un puente hasta pasar a EF Migrations: solo agrega, nunca borra ni cambia datos.
/// </summary>
public static class SchemaUpgrades
{
    private static readonly (string Table, string Column, string SqlType)[] Columns =
    [
        // ("Products", "Brand", "TEXT NULL"),
    ];

    /// <summary>Índices nuevos (IF NOT EXISTS: no hace nada si ya están).</summary>
    private static readonly string[] Indexes = [];

    public static async Task ApplyAsync(DeliveryDbContext db)
    {
        var connection = db.Database.GetDbConnection();
        var wasClosed = connection.State != System.Data.ConnectionState.Open;
        if (wasClosed) await connection.OpenAsync();
        try
        {
            await CreateMissingTablesAsync(db, connection);

            foreach (var (table, column, type) in Columns)
            {
                await using var check = connection.CreateCommand();
                check.CommandText = $"SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = '{column}'";
                if (Convert.ToInt64(await check.ExecuteScalarAsync()) > 0) continue;

                await using var alter = connection.CreateCommand();
                alter.CommandText = $"ALTER TABLE \"{table}\" ADD COLUMN \"{column}\" {type}";
                await alter.ExecuteNonQueryAsync();
            }
            foreach (var sql in Indexes)
            {
                await using var index = connection.CreateCommand();
                index.CommandText = sql;
                await index.ExecuteNonQueryAsync();
            }
        }
        finally
        {
            if (wasClosed) await connection.CloseAsync();
        }
    }

    /// <summary>
    /// Crea las tablas del modelo que no existen en la base (y sus índices), usando el mismo script que generaría
    /// EnsureCreated. Las tablas que ya existen no se tocan.
    /// </summary>
    private static async Task CreateMissingTablesAsync(DeliveryDbContext db, System.Data.Common.DbConnection connection)
    {
        var existing = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        await using (var list = connection.CreateCommand())
        {
            list.CommandText = "SELECT name FROM sqlite_master WHERE type = 'table'";
            await using var reader = await list.ExecuteReaderAsync();
            while (await reader.ReadAsync()) existing.Add(reader.GetString(0));
        }

        var created = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var statements = db.Database.GenerateCreateScript()
            .Split(";", StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        foreach (var sql in statements)
        {
            var table = System.Text.RegularExpressions.Regex.Match(sql, "^CREATE TABLE \"([^\"]+)\"");
            var index = System.Text.RegularExpressions.Regex.Match(sql, "^CREATE (UNIQUE )?INDEX .* ON \"([^\"]+)\"",
                System.Text.RegularExpressions.RegexOptions.Singleline);
            var run = table.Success ? !existing.Contains(table.Groups[1].Value)
                : index.Success && created.Contains(index.Groups[2].Value);
            if (!run) continue;
            await using var cmd = connection.CreateCommand();
            cmd.CommandText = sql;
            await cmd.ExecuteNonQueryAsync();
            if (table.Success) created.Add(table.Groups[1].Value);
        }
    }
}
