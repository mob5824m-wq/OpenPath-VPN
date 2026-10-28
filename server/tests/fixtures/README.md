# Public test TLS material

These keys are public, disposable CI fixtures. The CA is trusted only by the
debuggable Android build and isolated tests; release builds do not include it.
Never use these certificates or keys for a real relay. The emulator test also
generates a temporary untrusted certificate and uses `stealth-tls-tap.mjs` to
inspect only TLS record metadata on the outer TCP connection. The tap is a test
fixture and must not be deployed.
