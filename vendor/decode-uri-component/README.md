# decode-uri-component 0.5.1 compatibility package

The JavaScript, types and MIT license are copied unchanged from the upstream npm 0.5.1 tarball. Its SHA-512 integrity is `sha512-vWHQkXgg2cE3BB4rR0c+PYw9BCQzLoNIRMI7AunIkZst74tw/vpPp7VLoYtsR/cy1f55g3XDWUslfeCZjiZJyA==`.

MinIO 8.0.7 uses CommonJS query-string 7.1.3, which requires a callable decoder export. Patched decoder 0.5.1 ships ESM only. The added `index.cjs` and conditional require export adapt that interface using Node 22’s synchronous ESM support. The parser itself is unchanged. The root override selects this package; remove it when MinIO’s dependency chain supports the patched decoder directly.

Upstream patch: https://github.com/advisories/GHSA-qr28-fpjm-wq7f. Version 0.5.0 remains affected. Retain the source and its license when refreshing this compatibility package. Rollback restores the previous override and lockfile, which reintroduces the reported availability vulnerability.
