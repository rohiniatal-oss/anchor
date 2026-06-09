import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";

function normalizeGeneratedSources() {
  return {
    postcssPlugin: "anchor-normalize-generated-sources",
    Once(root) {
      const rootSource = root.source;
      if (!rootSource) return;
      root.walk((node) => {
        if (!node.source) node.source = rootSource;
      });
    },
  };
}

normalizeGeneratedSources.postcss = true;

export default {
  plugins: [
    tailwindcss(),
    autoprefixer(),
    normalizeGeneratedSources(),
  ],
}
