// Workers reject `redirect: "error"`. Upstream requests must still never follow
// a redirect (credentials would go to another origin), so send them as
// "manual" and fail any redirect response the way "error" would.
export function noRedirect(base: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await base(input, {
      ...init,
      redirect: "manual",
    } as RequestInit);
    if (
      response.type === "opaqueredirect" ||
      (response.status >= 300 && response.status < 400)
    ) {
      await response.body?.cancel();
      throw new TypeError("Upstream redirects are not followed.");
    }
    return response;
  };
}

export const edgeFetch: typeof fetch = noRedirect((input, init) =>
  fetch(input, init),
);
