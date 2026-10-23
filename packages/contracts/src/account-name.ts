/** Why an account name cannot be used, in words the player can read; null when it is fine. */
export function accountNameProblem(name: string): string | null {
  const trimmed = name.trim();
  const control = Array.from(trimmed).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  return !trimmed || trimmed.length > 48 || control
    ? "Enter a name of 1–48 characters without control characters."
    : null;
}
