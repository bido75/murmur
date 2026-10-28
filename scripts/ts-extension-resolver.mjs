// Resolve hook for the Node test runner: TypeScript modules in this repo use
// extensionless relative imports (the bundler resolves them), which Node's
// strip-types loader cannot. When a relative specifier fails to resolve, retry
// with ".ts". Registered programmatically by src/lib/recoveryTestKit.ts before
// the production modules are imported.
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (e) {
    if (
      e &&
      e.code === "ERR_MODULE_NOT_FOUND" &&
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL
    ) {
      return await next(`${specifier}.ts`, context);
    }
    throw e;
  }
}
