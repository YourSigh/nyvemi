const { defineConfig } = require('eslint/config');
const expo = require('eslint-config-expo/flat');
module.exports = defineConfig([expo,{ ignores:['android/**','ios/**','artifacts/**','coverage/**'] },{files:['**/*.ts','**/*.tsx'],rules:{'import/order':'off','@typescript-eslint/array-type':'off','@typescript-eslint/no-explicit-any':'error'}}]);
