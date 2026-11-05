# Solid surface contrast fixture

Serve the repository over localhost and open `tests/diagnostics/theme-contrast.html`.
The fixture loads the manifest's actual styles and the shared settings module.
It models YouTube's native text colours separately from the system canvas scheme.

In browser developer tools, emulate `prefers-reduced-transparency: reduce` and
`forced-colors: none`. Enable **Follow system transparency**. Run **Measure contrast** with YouTube dark and System canvas
light, then **Run theme matrix**. The matrix covers 24 combinations of the native
site theme, system canvas scheme, glass theme, and default/zero opacity. Each solid
surface should have a text contrast ratio of at least 4.5:1. Transparent surfaces
are reported as `null`, since their contrast depends on the pixels behind them.

Also check the default media state, forced colours, and the extension switched off.
With **Follow system transparency** off, reduced transparency alone must not force
the header/sidebar/player into solid Canvas fills or disable their glass filters.
The palette rules should apply only with reduced transparency, Follow system
transparency selected, without forced colours, and with the extension enabled.
The fixture does not replace testing the
extension on YouTube or on the affected user's machine.

For comparison with a previous build, concatenate that build's manifest CSS files
in manifest order into `dist/theme-baseline.css` and open the fixture with
`?baseline=1`. This local baseline is ignored by Git and is not packaged.
