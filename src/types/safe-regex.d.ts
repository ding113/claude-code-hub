/**
 * Type declaration for safe-regex package
 * https://www.npmjs.com/package/safe-regex
 */
declare module "safe-regex" {
  /**
   * Detects potentially catastrophic exponential-time regular expressions.
   * @param pattern - The regular expression pattern to test
   * @returns true if the pattern is safe, false if it may cause ReDoS
   */
  function safeRegex(pattern: string | RegExp): boolean;
  export default safeRegex;
}
