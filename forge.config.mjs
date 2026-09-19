// @electron-forge configuration for MarkSeek.
// Cross-platform packaging: Windows (Squirrel), Linux (deb/rpm/AppImage),
// macOS (dmg/zip). Code signing is opt-in via env vars (skipped if absent).
// The maker packages are CommonJS; import via default export then destructure.
import pkgSquirrel from '@electron-forge/maker-squirrel'
import pkgDeb from '@electron-forge/maker-deb'
import pkgRpm from '@electron-forge/maker-rpm'
import pkgDmg from '@electron-forge/maker-dmg'
import pkgZip from '@electron-forge/maker-zip'
const { MakerSquirrel } = pkgSquirrel
const { MakerDeb } = pkgDeb
const { MakerRpm } = pkgRpm
const { MakerDMG } = pkgDmg
const { MakerZIP } = pkgZip

const config = {
  packagerConfig: {
    name: 'MarkSeek',
    executableName: 'markseek',
    asar: true,
    // Copy the built Vite frontend so the main process can serve it.
    extraResource: ['./dist'],
    appBundleId: 'com.markseek.app',
    // App icon derived from public/markseek.svg (markseek.png/.ico/.icns generated
    // via cairosvg + ImageMagick). electron-packager picks the right format per OS.
    icon: './app/assets/static/markseek',
    // Signing env vars are consumed automatically by electron-packager/osx-sign
    // when present; otherwise packaging proceeds unsigned.
    osxSign: process.env.APPLE_ID
      ? {
          identity: process.env.APPLE_IDENTITY || 'Developer ID Application',
          appleId: process.env.APPLE_ID,
          appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
          teamId: process.env.APPLE_TEAM_ID,
        }
      : undefined,
    // Windows Authenticode signing (falls back to unsigned if no cert).
    win32metadata: { CompanyName: 'MarkSeek' },
  },
  rebuildConfig: {},
  plugins: [],
}

// On non-Windows hosts, Squirrel requires Mono+Wine (unavailable here), so we
// fall back to a plain ZIP distributable that still ships a runnable Windows
// build (markseek.exe). On real Windows CI the Squirrel installer is produced
// as well.
const isWin = process.platform === 'win32'
config.makers = [
  ...(isWin
    ? [
        new MakerSquirrel({
          name: 'MarkSeek',
          setupIcon: './app/assets/static/markseek.ico',
        }),
      ]
    : []),
  new MakerDMG({
    name: 'MarkSeek',
  }),
  new MakerZIP({}, ['darwin', 'win32']),
  new MakerDeb({
    options: {
      name: 'markseek',
      productName: 'MarkSeek',
      categories: ['Utility', 'Office'],
      icon: './app/assets/static/markseek.png',
    },
  }),
  new MakerRpm({
    options: {
      name: 'markseek',
      productName: 'MarkSeek',
      categories: ['Utility', 'Office'],
      icon: './app/assets/static/markseek.png',
    },
  }),
]

export default config
