const { withPodfile } = require("expo/config-plugins");
const { mergeContents } = require("@expo/config-plugins/build/utils/generateCode");

/**
 * Firebase iOS Podfile fixes for React Native Firebase:
 * 1. $RNFirebaseAsStaticFramework = true - for RNFB to build correctly
 * 2. CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES = YES - fixes "include of non-modular header inside framework module" (RNFBApp, RCTConvert.h)
 *
 * NOTE: Do NOT add use_modular_headers! - RNFB maintainer: "any use of modular_headers will mean support is denied"
 * and it causes "Native module RNFBAppModule not found".
 */
function withFirebaseModularHeaders(config) {
  return withPodfile(config, (config) => {
    let contents = config.modResults.contents;
    if (!contents || typeof contents !== "string") return config;

    // Add $RNFirebaseAsStaticFramework = true before use_native_modules (fixes non-modular header errors)
    if (!contents.includes("$RNFirebaseAsStaticFramework")) {
      try {
        const rnfbResult = mergeContents({
          tag: "rnfb-static-framework",
          src: contents,
          newSrc: "$RNFirebaseAsStaticFramework = true",
          anchor: /use_native_modules!/,
          offset: -1,
          comment: "#",
        });
        if (rnfbResult.didMerge || rnfbResult.didClear) contents = rnfbResult.contents;
      } catch (e) {
        console.warn("[withFirebaseModularHeaders] Could not add RNFirebaseAsStaticFramework:", e.message);
      }
    }

    // Add CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES inside post_install (fixes RNFBApp RCTConvert.h error)
    // mergeContents matches anchor line-by-line; we add right after "post_install do |installer|"
    if (!contents.includes("CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES")) {
      try {
        const clangResult = mergeContents({
          tag: "clang-allow-non-modular-includes",
          src: contents,
          newSrc: `    installer.pods_project.targets.flat_map(&:build_configurations).each { |bc|
      bc.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'Yes'
    }
`,
          anchor: /post_install do \|installer\|/,
          offset: 1,
          comment: "#",
        });
        if (clangResult.didMerge || clangResult.didClear) contents = clangResult.contents;
      } catch (e) {
        console.warn("[withFirebaseModularHeaders] Could not add CLANG_ALLOW_NON_MODULAR_INCLUDES:", e.message);
      }
    }

    config.modResults.contents = contents;
    return config;
  });
}

module.exports = withFirebaseModularHeaders;
