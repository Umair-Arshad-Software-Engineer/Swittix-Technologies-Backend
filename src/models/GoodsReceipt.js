// src/models/GoodsReceipt.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const GoodsReceipt = sequelize.define('GoodsReceipt', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        gr_number: { 
            type: DataTypes.STRING(50), 
            allowNull: false, 
            unique: true 
        },
        purchase_order_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'purchase_orders', key: 'id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
        },
        supplier_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'suppliers', key: 'id' },
            onDelete: 'RESTRICT',
        },
        receipt_date: {
            type: DataTypes.DATEONLY,
            allowNull: false,
            defaultValue: DataTypes.NOW,
        },
        status: {
            type: DataTypes.ENUM('draft', 'confirmed', 'cancelled'),
            allowNull: false,
            defaultValue: 'confirmed',
        },
        // Reference to supplier's invoice/bill
        supplier_invoice_number: { type: DataTypes.STRING(100), allowNull: true },
        supplier_invoice_date: { type: DataTypes.DATEONLY, allowNull: true },
        // Totals
        subtotal: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        tax_amount: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        shipping_amount: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        discount_amount: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        total_amount: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        // Payment
        paid_amount: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        payment_status: {
            type: DataTypes.ENUM('unpaid', 'partial', 'paid'),
            defaultValue: 'unpaid',
        },
        payment_method: { type: DataTypes.STRING(50), allowNull: true },
        // Notes
        notes: { type: DataTypes.TEXT, allowNull: true, defaultValue: '' },
        // Audit
        received_by: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'users', key: 'id' },
            onDelete: 'SET NULL',
        },
        // ✅ For offline sync
        local_uuid: { type: DataTypes.STRING(100), allowNull: true, unique: true },
    }, {
        tableName: 'goods_receipts',
        timestamps: true,
        underscored: false,
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
        indexes: [
            { fields: ['gr_number'] },
            { fields: ['purchase_order_id'] },
            { fields: ['supplier_id'] },
            { fields: ['receipt_date'] },
            { fields: ['local_uuid'] },
        ],
    });

    return GoodsReceipt;
};