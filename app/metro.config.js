const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// @bible-strong/avatar-core compiles an Ajv schema at import time (needs `new Function`,
// which Hermes lacks). We only render pre-validated bundled JSON, so stub Ajv out.
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (ctx, name, platform) => {
  if (name === 'ajv' || name.startsWith('ajv/')) {
    return { type: 'sourceFile', filePath: path.join(__dirname, 'src/shims/ajv-stub.js') };
  }
  return (upstream ?? ctx.resolveRequest)(ctx, name, platform);
};

module.exports = config;
