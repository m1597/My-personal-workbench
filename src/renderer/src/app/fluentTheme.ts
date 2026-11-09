import { webDarkTheme, webLightTheme, type Theme } from '@fluentui/react-components'
import type { Theme as ColorTheme } from '../../../shared/theme'

// Adapt our existing CSS tokens; no second brand palette or font stack.
export function fluentTheme(mode: ColorTheme): Theme {
  return {
    ...(mode === 'dark' ? webDarkTheme : webLightTheme),
    fontFamilyBase: 'var(--font-ui)',
    fontFamilyNumeric: 'var(--font-ui)',
    fontSizeBase200: 'var(--font-size-caption)',
    fontSizeBase300: 'var(--font-size-body)',
    fontSizeBase400: 'var(--font-size-heading)',
    fontWeightRegular: Number(
      getComputedStyle(document.documentElement).getPropertyValue('--font-weight-regular'),
    ),
    fontWeightSemibold: Number(
      getComputedStyle(document.documentElement).getPropertyValue('--font-weight-medium'),
    ),
    borderRadiusMedium: 'var(--radius-6)',
    colorNeutralForeground1: 'var(--text)',
    colorNeutralForeground2: 'var(--text-secondary)',
    colorNeutralForeground3: 'var(--text-muted)',
    colorNeutralForegroundDisabled: 'var(--text-muted)',
    colorNeutralForeground1Hover: 'var(--text)',
    colorNeutralForeground1Pressed: 'var(--text)',
    colorNeutralForeground2Hover: 'var(--text)',
    colorNeutralForeground2Pressed: 'var(--text)',
    colorNeutralForeground2BrandHover: 'var(--accent)',
    colorNeutralBackground1: 'var(--solid-surface)',
    colorNeutralBackground1Hover: 'var(--hover)',
    colorNeutralBackground1Pressed: 'var(--control)',
    colorNeutralBackground1Selected: 'var(--accent-soft)',
    colorNeutralBackgroundDisabled: 'var(--control)',
    colorNeutralBackgroundInverted: 'var(--text)',
    colorNeutralStroke1: 'var(--stroke)',
    colorNeutralStroke1Hover: 'var(--stroke-strong)',
    colorNeutralStroke1Pressed: 'var(--accent)',
    colorNeutralStrokeAccessible: 'var(--stroke-strong)',
    colorNeutralStrokeAccessibleHover: 'var(--accent)',
    colorNeutralStrokeAccessiblePressed: 'var(--accent)',
    colorNeutralStrokeDisabled: 'var(--stroke)',
    colorStrokeFocus2: 'var(--accent)',
    colorBrandBackground: 'var(--accent)',
    colorBrandBackgroundHover: 'var(--accent-hover)',
    colorBrandBackgroundPressed: 'var(--accent)',
    colorBrandForeground1: 'var(--accent)',
    colorBrandForeground2: 'var(--accent)',
    colorBrandStroke1: 'var(--accent)',
    colorNeutralForegroundOnBrand: 'var(--on-accent)',
    shadow16: 'var(--shadow-menu)',
    shadow64: 'var(--shadow-dialog)',
  }
}
