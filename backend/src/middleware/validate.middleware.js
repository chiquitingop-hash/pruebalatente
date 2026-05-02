/**
 * @module middleware/validate
 * @description Validation middleware using express-validator.
 * Collects all validation errors and returns them in a consistent format.
 */

const { validationResult } = require('express-validator');
const AppError = require('../shared/errors/AppError');

/**
 * Run after express-validator chains.
 * If there are validation errors, returns 422 with details.
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const details = errors.array().map((err) => ({
      field: err.path || err.param,
      message: err.msg,
      value: err.value,
    }));

    return next(
      new AppError('Error de validación', 422, 'VALIDATION_ERROR', details)
    );
  }

  next();
};

module.exports = { validate };

