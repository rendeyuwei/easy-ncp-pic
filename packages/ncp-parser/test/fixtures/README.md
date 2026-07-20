# NCP Fixtures

These two genuine Nikon Picture Control files are the parser's regression gate.
They are NOT committed as text — obtain them from a source you have the right to use
(your own camera/NX Studio export, or nikonpc.com). Never auto-download (spec §1.2, §11).

Place these exact files here:

| File         | SHA-256                                                          | Name                 |
|--------------|------------------------------------------------------------------|----------------------|
| PICCON02.NCP | ed53222f4a2329c3f42a2dd6391b4b62d1214b1e3eac917d9bd11a8f22f9e43f | Fuji Astia           |
| PICCON33.NCP | 5a3e2e9a768234f0fa653f1fc50eef3993118788737e57fe4bbd8d219fa8bc12 | SHING TokugawaTone2  |

Verify before running tests:

    shasum -a 256 PICCON02.NCP PICCON33.NCP

The golden tests re-assert these hashes, so a mismatched file fails the build.
