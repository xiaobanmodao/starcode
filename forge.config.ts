import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  packagerConfig: {
    asar: { unpack: '**/node_modules/node-pty/**' },
    executableName: 'starcode',
    ignore: (file) => {
      if (!file) return false;
      return !(
        file === '/package.json'
        || file.startsWith('/.vite')
        || file === '/node_modules'
        || file.startsWith('/node_modules/node-pty')
        || file.startsWith('/node_modules/node-addon-api')
      );
    },
    extraResource: [
      'resources/toolchains',
      'resources/cpp-compat',
      'licenses',
    ],
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: 'StarCode',
      setupExe: 'StarCode-Windows-x64-Setup.exe',
    }),
    new MakerDMG({
      name: 'StarCode-macOS-arm64',
      format: 'ULFO',
    }),
    new MakerZIP({}, ['darwin']),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;
