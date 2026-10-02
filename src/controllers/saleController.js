// src/controllers/saleController.js
const crypto = require('crypto');
const db = require('../models');

const PRODUCT_ATTRS = ['id', 'name', 'sale_rate'];

const DEFAULT_BRANCH_ID = process.env.DEFAULT_BRANCH_ID
    ? parseInt(process.env.DEFAULT_BRANCH_ID, 10)
    : null;

const SALE_INCLUDES = [
    {
        association: 'items',
        include: [{ association: 'product', attributes: PRODUCT_ATTRS }],
    },
    { association: 'seller', attributes: ['name'] },
];

// ── GET ALL (paginated) ────────────────────────────────────────────────
const getAllSales = async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.max(parseInt(req.query.limit, 10) || 50, 1);
        const offset = (page - 1) * limit;

        const whereClause = req.user.role === 'user'
            ? { sold_by: req.user.id }
            : {};

        const { rows, count } = await db.Sale.findAndCountAll({
            where: whereClause,
            include: SALE_INCLUDES,
            order: [['sale_date', 'DESC']],
            limit,
            offset,
            distinct: true,
        });

        res.json({
            success: true,
            sales: rows,
            page,
            limit,
            total: count,
            total_pages: Math.max(Math.ceil(count / limit), 1),
            has_more: offset + rows.length < count,
        });
    } catch (error) {
        console.error('getAllSales error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ── GET ONE ────────────────────────────────────────────────────────────
const getSale = async (req, res) => {
    try {
        const sale = await db.Sale.findByPk(req.params.id, {
            include: SALE_INCLUDES,
        });

        if (!sale) {
            return res.status(404).json({ success: false, message: 'Sale not found' });
        }
        res.json({ success: true, sale });
    } catch (error) {
        console.error('getSale error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ── CREATE ─────────────────────────────────────────────────────────────
const createSale = async (req, res) => {
    try {
        const {
            items,
            customer_name,
            customer_phone,
            discount = 0,
            branch_id,
            local_uuid,
        } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'At least one item is required'
            });
        }

        if (local_uuid) {
            const existing = await db.Sale.findOne({
                where: { local_uuid },
                include: SALE_INCLUDES,
            });
            if (existing) {
                return res.status(200).json({
                    success: true,
                    sale: existing,
                    message: 'Sale already exists (idempotent)'
                });
            }
        }

        const resolvedBranchId = req.user.branch_id || branch_id || DEFAULT_BRANCH_ID;

        if (!resolvedBranchId) {
            return res.status(400).json({
                success: false,
                message: 'branch_id is required (no user branch, no branch_id provided, and DEFAULT_BRANCH_ID not configured)'
            });
        }

        const branchExists = await db.Branch.findByPk(resolvedBranchId);
        if (!branchExists) {
            return res.status(400).json({
                success: false,
                message: `branch_id ${resolvedBranchId} does not exist.`
            });
        }

        let sale;
        try {
            sale = await db.sequelize.transaction(async (t) => {
                let subtotal = 0;
                let totalTax = 0;
                const resolvedItems = [];

                for (const item of items) {
                    const product = await db.Product.findByPk(item.product_id, { transaction: t });
                    if (!product) {
                        throw new Error(`Product ${item.product_id} not found`);
                    }

                    const taxPercentage = item.tax_percentage || product.tax_percentage || 0;
                    const unit_price = parseFloat(product.sale_rate);
                    const itemSubtotal = unit_price * item.quantity;
                    const itemTax = (itemSubtotal * taxPercentage) / 100;

                    subtotal += itemSubtotal;
                    totalTax += itemTax;

                    resolvedItems.push({
                        product_id: item.product_id,
                        product_name: product.name,
                        quantity: item.quantity,
                        unit_price,
                        subtotal: itemSubtotal,
                        tax_percentage: taxPercentage,
                        tax_amount: itemTax,
                    });
                }

                const parsedDiscount = parseFloat(discount) || 0;
                const total_price = subtotal + totalTax - parsedDiscount;

                if (total_price < 0) {
                    throw new Error('Discount cannot exceed the total (subtotal + tax)');
                }

                const newSale = await db.Sale.create({
                    local_uuid: local_uuid || crypto.randomUUID(),
                    branch_id: resolvedBranchId,
                    customer_name: customer_name || '',
                    customer_phone: customer_phone || '',
                    discount: parsedDiscount,
                    total_price,
                    total_tax: totalTax,
                    sold_by: req.user.id,
                }, { transaction: t });

                for (const item of resolvedItems) {
                    await db.SaleItem.create({
                        ...item,
                        sale_id: newSale.id
                    }, { transaction: t });
                }

                return newSale;
            });
        } catch (createError) {
            if (createError.name === 'SequelizeUniqueConstraintError' && local_uuid) {
                const existing = await db.Sale.findOne({
                    where: { local_uuid },
                    include: SALE_INCLUDES,
                });
                if (existing) {
                    return res.status(200).json({
                        success: true,
                        sale: existing,
                        message: 'Sale already exists (idempotent)'
                    });
                }
            }
            throw createError;
        }

        const fullSale = await db.Sale.findByPk(sale.id, {
            include: SALE_INCLUDES,
        });

        res.status(201).json({
            success: true,
            sale: fullSale,
            message: 'Sale recorded successfully'
        });

    } catch (error) {
        console.error('createSale error:', error);

        let status = 500;
        let message = 'Server error';

        if (error.message.includes('not found')) {
            status = 404;
            message = error.message;
        } else if (error.message.includes('exceed')) {
            status = 400;
            message = error.message;
        } else if (error.message.includes('required')) {
            status = 400;
            message = error.message;
        }

        res.status(status).json({
            success: false,
            message
        });
    }
};

// ── UPDATE ─────────────────────────────────────────────────────────────
const updateSale = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const sale = await db.Sale.findByPk(req.params.id, { transaction: t });

        if (!sale) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Sale not found' });
        }

        const { items, customer_name, customer_phone, discount = 0 } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'At least one item is required' });
        }

        let subtotal = 0;
        let totalTax = 0;
        const resolvedItems = [];

        for (const item of items) {
            const product = await db.Product.findByPk(item.product_id, { transaction: t });
            if (!product) {
                await t.rollback();
                return res.status(404).json({ success: false, message: `Product ${item.product_id} not found` });
            }

            const taxPercentage = item.tax_percentage || product.tax_percentage || 0;
            const unit_price = parseFloat(product.sale_rate);
            const itemSubtotal = unit_price * item.quantity;
            const itemTax = (itemSubtotal * taxPercentage) / 100;

            subtotal += itemSubtotal;
            totalTax += itemTax;

            resolvedItems.push({
                sale_id: sale.id,
                product_id: item.product_id,
                product_name: product.name,
                quantity: item.quantity,
                unit_price,
                subtotal: itemSubtotal,
                tax_percentage: taxPercentage,
                tax_amount: itemTax,
            });
        }

        const parsedDiscount = parseFloat(discount) || 0;
        const total_price = subtotal + totalTax - parsedDiscount;

        if (total_price < 0) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Discount cannot exceed the subtotal' });
        }

        await db.SaleItem.destroy({ where: { sale_id: sale.id }, transaction: t });
        await db.SaleItem.bulkCreate(resolvedItems, { transaction: t });

        await sale.update({
            customer_name: customer_name ?? sale.customer_name,
            customer_phone: customer_phone ?? sale.customer_phone,
            discount: parsedDiscount,
            total_price,
            total_tax: totalTax,
        }, { transaction: t });

        await t.commit();

        const updatedSale = await db.Sale.findByPk(sale.id, {
            include: SALE_INCLUDES,
        });

        res.json({ success: true, sale: updatedSale, message: 'Sale updated successfully' });
    } catch (error) {
        await t.rollback();
        console.error('updateSale error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ── DELETE ─────────────────────────────────────────────────────────────
const deleteSale = async (req, res) => {
    try {
        const sale = await db.Sale.findByPk(req.params.id);

        if (!sale) {
            return res.status(404).json({ success: false, message: 'Sale not found' });
        }

        await sale.destroy();
        res.json({ success: true, message: 'Sale deleted successfully' });
    } catch (error) {
        console.error('deleteSale error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ── REPORT ─────────────────────────────────────────────────────────────
const getSalesReport = async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        const report = await db.Sale.getReport(start_date, end_date);
        res.json({ success: true, report });
    } catch (error) {
        console.error('getSalesReport error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

module.exports = {
    getAllSales,
    getSale,
    createSale,
    updateSale,
    deleteSale,
    getSalesReport,
};