// src/controllers/priceHistoryController.js
const db = require('../models');

const formatHistoryEntry = (h) => {
    const json = h.toJSON();
    return {
        id: json.id,
        entity_type: json.entity_type,
        product_id: json.product_id,
        product_name: json.product?.name || null,
        customer_id: json.customer_id,
        customer_name: json.customer?.name || null,
        customer_price_id: json.customer_price_id,
        field_name: json.field_name,
        old_value: json.old_value !== null ? parseFloat(json.old_value) : null,
        new_value: parseFloat(json.new_value),
        changed_by: json.changed_by,
        changed_by_name: json.changedByUser?.name || 'Unknown',
        change_reason: json.change_reason || '',
        created_at: json.createdAt,
    };
};

const historyIncludes = [
    { association: 'product', attributes: ['name'], required: false },
    { association: 'customer', attributes: ['name'], required: false },
    { association: 'changedByUser', attributes: ['name'], required: false },
];

/**
 * Records one history row. Always call from within the same transaction
 * as the actual rate/price mutation.
 */
const logPriceChange = async ({
    entityType,
    productId,
    customerId = null,
    customerPriceId = null,
    fieldName,
    oldValue,
    newValue,
    changedBy,
    reason = '',
}, transaction = null) => {
    return db.PriceHistory.create({
        entity_type: entityType,
        product_id: productId,
        customer_id: customerId,
        customer_price_id: customerPriceId,
        field_name: fieldName,
        old_value: oldValue,
        new_value: newValue,
        changed_by: changedBy,
        change_reason: reason,
    }, { transaction });
};

// GET /price-history?product_id=&customer_id=&entity_type=&field_name=&page=&limit=
const getPriceHistory = async (req, res) => {
    try {
        const {
            product_id, customer_id, entity_type, field_name,
            page = 1, limit = 500,
        } = req.query;

        const where = {};
        if (product_id)  where.product_id  = product_id;
        if (customer_id) where.customer_id = customer_id;
        if (entity_type) where.entity_type = entity_type;
        if (field_name)  where.field_name  = field_name;

        const offset = (parseInt(page) - 1) * parseInt(limit);

        const { rows, count } = await db.PriceHistory.findAndCountAll({
            where,
            include: historyIncludes,
            order: [['createdAt', 'DESC']],
            limit: parseInt(limit),
            offset,
        });

        res.json({
            success: true,
            history: rows.map(formatHistoryEntry),
            total: count,
            page: parseInt(page),
            totalPages: Math.ceil(count / parseInt(limit)),
        });
    } catch (error) {
        console.error('getPriceHistory error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ✅ NEW: POST /price-history
// Accepts a fully-specified history row from the client (offline-created).
// Does NOT call logPriceChange — this is a raw insert so the client's
// old_value / new_value / changed_by / created_at are preserved exactly.
const createPriceHistory = async (req, res) => {
    try {
        const {
            entity_type,
            product_id,
            customer_id = null,
            customer_price_id = null,
            field_name,
            old_value = null,
            new_value,
            changed_by = null,
            change_reason = '',
            created_at = null,
        } = req.body;

        // --- Validation ---
        if (!entity_type || !['product', 'customer_price'].includes(entity_type)) {
            return res.status(400).json({
                success: false,
                message: 'entity_type must be "product" or "customer_price"',
            });
        }
        if (!product_id) {
            return res.status(400).json({
                success: false,
                message: 'product_id is required',
            });
        }
        if (!field_name) {
            return res.status(400).json({
                success: false,
                message: 'field_name is required',
            });
        }
        if (new_value === undefined || new_value === null) {
            return res.status(400).json({
                success: false,
                message: 'new_value is required',
            });
        }

        const parsedNewValue = parseFloat(new_value);
        if (isNaN(parsedNewValue)) {
            return res.status(400).json({
                success: false,
                message: 'new_value must be a number',
            });
        }

        const parsedOldValue = (old_value !== null && old_value !== undefined)
            ? parseFloat(old_value)
            : null;

        // --- Idempotency: if the client already sent this exact row, don't duplicate ---
        // We use (entity_type, product_id, customer_id, field_name,
        //       old_value, new_value, changed_by, createdAt) as the natural key
        // because there's no uuid column on this table.
        const where = {
            entity_type,
            product_id,
            field_name,
            new_value: parsedNewValue,
        };
        if (customer_id)         where.customer_id = customer_id;
        if (customer_price_id)   where.customer_price_id = customer_price_id;
        if (parsedOldValue !== null) where.old_value = parsedOldValue;

        const existing = await db.PriceHistory.findOne({ where });
        if (existing) {
            const full = await db.PriceHistory.findByPk(existing.id, {
                include: historyIncludes,
            });
            return res.status(200).json({
                success: true,
                price_history: formatHistoryEntry(full),
                message: 'Price history already exists',
            });
        }

        // --- Insert ---
        const createData = {
            entity_type,
            product_id,
            customer_id,
            customer_price_id,
            field_name,
            old_value: parsedOldValue,
            new_value: parsedNewValue,
            changed_by: changed_by || req.user?.id || null,
            change_reason: change_reason || '',
        };

        // Preserve the client's original timestamp if provided
        if (created_at) {
            const parsedDate = new Date(created_at);
            if (!isNaN(parsedDate.getTime())) {
                createData.createdAt = parsedDate;
                createData.updatedAt = parsedDate;
            }
        }

        const created = await db.PriceHistory.create(createData);

        const full = await db.PriceHistory.findByPk(created.id, {
            include: historyIncludes,
        });

        return res.status(201).json({
            success: true,
            price_history: formatHistoryEntry(full),
            message: 'Price history created successfully',
        });
    } catch (error) {
        console.error('createPriceHistory error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
};

module.exports = {
    logPriceChange,
    getPriceHistory,
    createPriceHistory,   // ✅ NEW
};