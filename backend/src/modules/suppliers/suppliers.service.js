/**
 * @module modules/suppliers/suppliers.service
 */

const { query } = require('../../config/database');
const AppError = require('../../shared/errors/AppError');
const { AUDIT_EVENTS, MODULES } = require('../../config/constants');

class SuppliersService {
  async create(payload, auditLog) {
    const {
      nombre,
      tipo,
      ruc,
      identificador_fiscal,
      pais,
      direccion,
      contacto_nombre,
      contacto_email,
      contacto_telefono,
      notas,
    } = payload;

    const { rows } = await query(
      `INSERT INTO proveedores
         (nombre, tipo, ruc, identificador_fiscal, pais, direccion,
          contacto_nombre, contacto_email, contacto_telefono, notas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        nombre,
        tipo,
        ruc || null,
        identificador_fiscal || null,
        pais || null,
        direccion || null,
        contacto_nombre || null,
        contacto_email || null,
        contacto_telefono || null,
        notas || null,
      ]
    );

    await auditLog({
      event: AUDIT_EVENTS.SUPPLIER_CREATED,
      module: MODULES.SUPPLIERS,
      entityId: rows[0].id,
      entityType: 'proveedor',
      after: rows[0],
    });

    return rows[0];
  }

  async findAll({ page = 1, limit = 20, tipo, estado, search }) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (tipo) {
      conditions.push(`tipo = $${idx++}`);
      params.push(tipo);
    }
    if (estado) {
      conditions.push(`estado = $${idx++}`);
      params.push(estado);
    }
    if (search) {
      conditions.push(`(nombre ILIKE $${idx} OR ruc ILIKE $${idx} OR identificador_fiscal ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx += 1;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const [countResult, dataResult] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM proveedores ${where}`, params),
      query(
        `SELECT *
           FROM proveedores
           ${where}
           ORDER BY nombre ASC
           LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, limit, offset]
      ),
    ]);

    return {
      data: dataResult.rows,
      total: parseInt(countResult.rows[0].total, 10),
      page,
      pages: Math.ceil(parseInt(countResult.rows[0].total, 10) / limit) || 1,
    };
  }

  async findById(id) {
    const { rows } = await query(`SELECT * FROM proveedores WHERE id = $1`, [id]);
    if (!rows[0]) throw AppError.notFound('Proveedor');
    return rows[0];
  }

  async update(id, fields, auditLog) {
    const current = await this.findById(id);

    const allowed = [
      'nombre', 'tipo', 'ruc', 'identificador_fiscal', 'pais', 'direccion',
      'contacto_nombre', 'contacto_email', 'contacto_telefono', 'notas', 'estado',
    ];
    const sets = [];
    const params = [];
    let idx = 1;

    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        sets.push(`${key} = $${idx++}`);
        params.push(fields[key]);
      }
    }

    if (sets.length === 0) return current;

    sets.push(`actualizado_en = NOW()`);
    params.push(id);

    const { rows } = await query(
      `UPDATE proveedores SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );

    await auditLog({
      event: AUDIT_EVENTS.SUPPLIER_UPDATED,
      module: MODULES.SUPPLIERS,
      entityId: id,
      entityType: 'proveedor',
      before: current,
      after: rows[0],
    });

    return rows[0];
  }

  async deactivate(id, actor, auditLog) {
    const current = await this.findById(id);
    if (current.estado === 'inactivo') {
      throw AppError.conflict('El proveedor ya está inactivo');
    }

    // Guard: no puede desactivarse si tiene OCs activas
    const { rows: ocRows } = await query(
      `SELECT COUNT(*)::int AS total
         FROM ordenes_compra_exterior
        WHERE proveedor_id = $1 AND estado IN ('borrador', 'aprobada', 'parcial')`,
      [id]
    );
    if (ocRows[0].total > 0) {
      throw AppError.unprocessable(
        `No se puede desactivar: el proveedor tiene ${ocRows[0].total} orden(es) de compra en curso.`
      );
    }

    const { rows } = await query(
      `UPDATE proveedores
          SET estado = 'inactivo', actualizado_en = NOW()
        WHERE id = $1
        RETURNING *`,
      [id]
    );

    await auditLog({
      event: AUDIT_EVENTS.SUPPLIER_DEACTIVATED,
      module: MODULES.SUPPLIERS,
      entityId: id,
      entityType: 'proveedor',
      before: { estado: current.estado, nombre: current.nombre },
      after:  { estado: rows[0].estado, nombre: rows[0].nombre },
      metadata: actor ? { actor_id: actor.id } : null,
    });

    return rows[0];
  }
}

module.exports = new SuppliersService();

