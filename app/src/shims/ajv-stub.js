// Stand-in for Ajv: every schema "validates". See metro.config.js.
class Ajv {
  compile() {
    const validate = () => true;
    validate.errors = null;
    return validate;
  }
  addFormat() { return this; }
  addKeyword() { return this; }
}
module.exports = Ajv;
module.exports.default = Ajv;
module.exports.Ajv = Ajv;
module.exports.__esModule = true;
