// src/controllers/customerPriceController.js
const { Op } = require('sequelize');
const db = require('../models');
const { logPriceChange } = require('./priceHistoryController');

const formatCustomerPrice = (cp) => {
    const json = cp.toJSON();
    return {
        id: json.id,
        customer_id: json.customer_id,
        customer_name: json.customer?.name || null,
        customer_phone: json.customer?.phone || null,
        product_id: json.product_id,
        product_name: json.product?.name || null,
        product_item_code: json.product?.item_code || null,
        product_sale_rate: json.product ? parseFloat(json.product.sale_rate) : null,
        custom_price: parseFloat(json.custom_price || 0),
        min_qty: parseFloat(json.min_qty || 1),
        notes: json.notes || '',
        is_active: !!json.is_active,
        created_by: json.created_by,
        created_by_name: json.creator?.name || 'Unknown',
        created_at: json.createdAt,
        updated_at: json.updatedAt,
    };
};

const priceIncludes = [
    { association: 'customer', attributes: ['name', 'phone'], required: false },
    { association: 'product',  attributes: ['name', 'item_code', 'sale_rate'], required: false },
    { association: 'creator',  attributes: ['name'], required: false },
];

// GET /customer-prices?customer_id=&product_id=
const getAllCustomerPrices = async (req, res) => {
    try {
        const { customer_id, product_id } = req.query;
        const where = {};
        if (customer_id) where.customer_id = customer_id;
        if (product_id)  where.product_id  = product_id;

        const rows = await db.CustomerPrice.findAll({
            where,
            include: priceIncludes,
            order: [['id', 'DESC']],
        });

        res.json({
            success: true,
            customer_prices: rows.map(formatCustomerPrice),
            total: rows.length,
        });
    } catch (error) {
        console.error('getAllCustomerPrices error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// GET /customer-prices/:id
const getCustomerPrice = async (req, res) => {
    try {
        const cp = await db.CustomerPrice.findByPk(req.params.id, { include: priceIncludes });
        if (!cp) return res.status(404).json({ success: false, message: 'Customer price not found' });
        res.json({ success: true, customer_price: formatCustomerPrice(cp) });
    } catch (error) {
        console.error('getCustomerPrice error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// POST /customer-prices
const createCustomerPrice = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const {
            customer_id, product_id, custom_price,
            min_qty = 1, notes = '', is_active = true,
            change_reason = '',
        } = req.body;

        if (!customer_id || !product_id) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: 'customer_id and product_id are required',
            });
        }
        const price = parseFloat(custom_price);
        if (isNaN(price) || price < 0) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: 'custom_price must be a valid non-negative number',
            });
        }

        const cp = await db.CustomerPrice.create({
            customer_id,
            product_id,
            custom_price: price,
            min_qty: parseFloat(min_qty) || 1,
            notes: notes?.trim() || '',
            is_active: !!is_active,
            created_by: req.user.id,
        }, { transaction: t });

        // Log the initial value — old_value: null marks this as the first-ever price.
        await logPriceChange({
            entityType: 'customer_price',
            productId: product_id,
            customerId: customer_id,
            customerPriceId: cp.id,
            fieldName: 'custom_price',
            oldValue: null,
            newValue: price,
            changedBy: req.user.id,
            reason: change_reason || 'Initial custom price',
        }, t);

        await t.commit();

        const full = await db.CustomerPrice.findByPk(cp.id, { include: priceIncludes });
        res.status(201).json({
            success: true,
            customer_price: formatCustomerPrice(full),
            message: 'Customer price created successfully',
        });
    } catch (error) {
        await t.rollback();
        console.error('createCustomerPrice error:', error);
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(409).json({
                success: false,
                message: 'A price already exists for this customer / product / min quantity',
            });
        }
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
};

// PUT /customer-prices/:id
const updateCustomerPrice = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const cp = await db.CustomerPrice.findByPk(req.params.id, { transaction: t });
        if (!cp) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Customer price not found' });
        }

        const { custom_price, min_qty, notes, is_active, change_reason = '' } = req.body;
        const updateData = {};

        const oldPrice = parseFloat(cp.custom_price);
        const oldMinQty = parseFloat(cp.min_qty);

        if (custom_price !== undefined) {
            const price = parseFloat(custom_price);
            if (isNaN(price) || price < 0) {
                await t.rollback();
                return res.status(400).json({ success: false, message: 'Invalid custom_price' });
            }
            updateData.custom_price = price;
        }
        if (min_qty !== undefined) updateData.min_qty = parseFloat(min_qty) || 1;
        if (notes !== undefined) updateData.notes = notes?.trim() || '';
        if (is_active !== undefined) updateData.is_active = !!is_active;

        await cp.update(updateData, { transaction: t });

        if (updateData.custom_price !== undefined && updateData.custom_price !== oldPrice) {
            await logPriceChange({
                entityType: 'customer_price',
                productId: cp.product_id,
                customerId: cp.customer_id,
                customerPriceId: cp.id,
                fieldName: 'custom_price',
                oldValue: oldPrice,
                newValue: updateData.custom_price,
                changedBy: req.user.id,
                reason: change_reason,
            }, t);
        }

        if (updateData.min_qty !== undefined && updateData.min_qty !== oldMinQty) {
            await logPriceChange({
                entityType: 'customer_price',
                productId: cp.product_id,
                customerId: cp.customer_id,
                customerPriceId: cp.id,
                fieldName: 'min_qty',
                oldValue: oldMinQty,
                newValue: updateData.min_qty,
                changedBy: req.user.id,
                reason: change_reason,
            }, t);
        }

        await t.commit();

        const full = await db.CustomerPrice.findByPk(cp.id, { include: priceIncludes });

        res.json({
            success: true,
            customer_price: formatCustomerPrice(full),
            message: 'Customer price updated successfully',
        });
    } catch (error) {
        await t.rollback();
        console.error('updateCustomerPrice error:', error);
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(409).json({
                success: false,
                message: 'A price already exists for this customer / product / min quantity',
            });
        }
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
};

// DELETE /customer-prices/:id
const deleteCustomerPrice = async (req, res) => {
    try {
        const cp = await db.CustomerPrice.findByPk(req.params.id);
        if (!cp) return res.status(404).json({ success: false, message: 'Customer price not found' });
        await cp.destroy();
        res.json({ success: true, message: 'Customer price deleted successfully' });
    } catch (error) {
        console.error('deleteCustomerPrice error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// GET /customer-prices/resolve?customer_id=&product_id=&qty=
const resolveCustomerPrice = async (req, res) => {
    try {
        const { customer_id, product_id } = req.query;
        const qty = parseFloat(req.query.qty) || 1;

        if (!customer_id || !product_id) {
            return res.status(400).json({
                success: false,
                message: 'customer_id and product_id are required',
            });
        }

        const cp = await db.CustomerPrice.findOne({
            where: {
                customer_id,
                product_id,
                is_active: true,
                min_qty: { [Op.lte]: qty },
            },
            order: [['min_qty', 'DESC']],
            include: priceIncludes,
        });

        res.json({
            success: true,
            customer_price: cp ? formatCustomerPrice(cp) : null,
        });
    } catch (error) {
        console.error('resolveCustomerPrice error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

module.exports = {
    getAllCustomerPrices,
    getCustomerPrice,
    createCustomerPrice,
    updateCustomerPrice,
    deleteCustomerPrice,
    resolveCustomerPrice,
};