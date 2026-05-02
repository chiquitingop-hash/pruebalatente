/**
 * @module modules/products/products.routes
 *
 * GET    /api/v1/products          - List products
 * POST   /api/v1/products          - Create product
 * GET    /api/v1/products/marcas   - List distinct brands
 * GET    /api/v1/products/categorias - List distinct categories
 * GET    /api/v1/products/:id      - Get product by ID
 * PATCH  /api/v1/products/:id      - Update product
 * DELETE /api/v1/products/:id      - Deactivate product
 */

const router = require('express').Router();
const { body, param } = require('express-validator');
const controller = require('./products.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { authorize } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { MODULES, ACTIONS, PRODUCT_STATUS } = require('../../config/constants');

// R1.3 — Validación compartida de campos farmacéuticos (opcionales en create y
// en update). Acepta null/vacío para permitir "quitar" el valor desde la UI.
const FORMAS_FARMACEUTICAS = [
  'tableta', 'capsula', 'jarabe', 'suspension', 'solucion', 'inyectable',
  'crema', 'ungüento', 'gel', 'polvo', 'supositorio', 'gotas', 'spray', 'parche', 'otro',
];

const pharmaValidation = [
  body('digemid_registro')
    .optional({ nullable: true, checkFalsy: true })
    .isString().trim()
    .isLength({ max: 50 }).withMessage('N° de registro DIGEMID demasiado largo (máx 50)'),
  body('forma_farmaceutica')
    .optional({ nullable: true, checkFalsy: true })
    .isString().trim()
    .isIn(FORMAS_FARMACEUTICAS).withMessage('Forma farmacéutica no reconocida'),
  body('concentracion')
    .optional({ nullable: true, checkFalsy: true })
    .isString().trim()
    .isLength({ max: 100 }).withMessage('Concentración demasiado larga (máx 100)'),
  body('requiere_cadena_frio')
    .optional({ nullable: true })
    .isBoolean().withMessage('requiere_cadena_frio debe ser booleano')
    .toBoolean(),
  body('temp_min_c')
    .optional({ nullable: true, checkFalsy: true })
    .isFloat({ min: -80, max: 80 }).withMessage('temp_min_c fuera de rango (-80 a 80)'),
  body('temp_max_c')
    .optional({ nullable: true, checkFalsy: true })
    .isFloat({ min: -80, max: 80 }).withMessage('temp_max_c fuera de rango (-80 a 80)')
    .custom((v, { req }) => {
      const min = req.body.temp_min_c;
      if (v !== undefined && min !== undefined && v !== null && min !== null && Number(v) < Number(min)) {
        throw new Error('temp_max_c no puede ser menor que temp_min_c');
      }
      return true;
    }),
];

const createValidation = [
  body('nombre').trim().notEmpty().withMessage('El nombre es requerido'),
  body('marca').trim().notEmpty().withMessage('La marca es requerida'),
  body('codigo_sku').optional().trim(),
  body('unidad_medida').optional().trim(),
  body('categoria').optional().trim(),
  ...pharmaValidation,
];

const updateValidation = [
  param('id').isUUID().withMessage('ID inválido'),
  body('estado').optional().isIn(Object.values(PRODUCT_STATUS)),
  ...pharmaValidation,
];

router.use(authenticate);

router.get('/marcas',     authorize(MODULES.PRODUCTS, ACTIONS.READ), controller.getMarcas);
router.get('/categorias', authorize(MODULES.PRODUCTS, ACTIONS.READ), controller.getCategorias);

router.get('/',
  authorize(MODULES.PRODUCTS, ACTIONS.READ),
  controller.findAll
);

router.post('/',
  authorize(MODULES.PRODUCTS, ACTIONS.CREATE),
  createValidation, validate,
  controller.create
);

router.get('/:id',
  authorize(MODULES.PRODUCTS, ACTIONS.READ),
  [param('id').isUUID()], validate,
  controller.findById
);

router.patch('/:id',
  authorize(MODULES.PRODUCTS, ACTIONS.UPDATE),
  updateValidation, validate,
  controller.update
);

router.delete('/:id',
  authorize(MODULES.PRODUCTS, ACTIONS.DELETE),
  [param('id').isUUID()], validate,
  controller.deactivate
);

module.exports = router;

