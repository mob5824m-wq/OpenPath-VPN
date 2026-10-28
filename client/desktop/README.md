# Legacy Electron desktop shell

This directory contains the earlier web-based Electron shell and its tests. It is retained for reference and regression coverage; **it is not the shipped desktop application and is not used by the release workflow**.

The actual non-web Linux, Windows and macOS desktop client is in [client/native](../native/README.md). It uses Qt Widgets and controls the separately configured WireGuard tunnel directly through system tools. The web dashboard remains a UI-testing preview.
