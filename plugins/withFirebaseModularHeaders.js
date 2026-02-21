const { withPodfile } = require("expo/config-plugins");
const { mergeContents } = require("@expo/config-plugins/build/utils/generateCode");

/**
 * Firebase iOS Podfile fixes for React Native Firebase:
 * 1. use_modular_headers! - for Firebase Swift pods (FirebaseCoreInternal, etc.)
 * 2. $RNFirebaseAsStaticFramework = true - for RNFB to build correctly
 */
function withFirebaseModularHeaders(config) {
  return withPodfile(config, (config) => {
    let contents = config.modResults.contents;

    // Add $RNFirebaseAsStaticFramework = true before use_native_modules (fixes non-modular header errors)
    if (!contents.includes("$RNFirebaseAsStaticFramework")) {
      const rnfbResult = mergeContents({
        tag: "rnfb-static-framework",
        src: contents,
        newSrc: "$RNFirebaseAsStaticFramework = true",
        anchor: /use_native_modules!/,
        offset: -1,
        comment: "#",
      });
      if (rnfbResult.didMerge || rnfbResult.didClear) contents = rnfbResult.contents;
    }

    // Add use_modular_headers! for Firebase Swift pods
    if (!contents.includes("use_modular_headers!")) {
      const modResult = mergeContents({
        tag: "use-modular-headers-firebase",
        src: contents,
        newSrc: "use_modular_headers!",
        anchor: /use_native_modules!/,
        offset: -1,
        comment: "#",
      });
      if (modResult.didMerge || modResult.didClear) contents = modResult.contents;
    }

    config.modResults.contents = contents;
    return config;
  });
}

module.exports = withFirebaseModularHeaders;
