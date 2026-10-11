// Only fixed, non-sensitive messages may cross HTTP/MCP/tool boundaries.
// SDK errors can contain request text, headers, file paths or credential details.
export function safeProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "Sensitive content cannot use cloud image generation.") return message;
  if (message === "Image generation is disabled. Configure a provider and opt in explicitly.") return message;
  if (/(^|\D)(429|401)(\D|$)|quota|rate.?limit|insufficient|billing|invalid_api_key|authentication|unauthorized/i.test(message)) {
    return (
      "Provider unavailable (authentication or quota). Check provider configuration; " +
      "do not retry automatically or change the data's privacy boundary."
    );
  }
  return "Provider request failed. Check configuration and service availability.";
}
