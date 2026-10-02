// src/models/PurchaseOrder.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const PurchaseOrder = sequelize.define('PurchaseOrder', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        po_number: { 
            type: DataTypes.STRING(50), 
            allowNull: false, 
            unique: true 
        },
        supplier_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'suppliers', key: 'id' },
            onDelete: 'RESTRICT',
            onUpdate: 'CASCADE',
        },
        branch_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'branches', key: 'id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
        },
        order_date: {
            type: DataTypes.DATEONLY,
            allowNull: false,
            defaultValue: DataTypes.NOW,
        },
        expected_date: {
            type: DataTypes.DATEONLY,
            allowNull: true,
        },
        // Status flow: draft -> ordered -> partially_received -> received -> cancelled
        status: {
            type: DataTypes.ENUM(
                'draft',
                'ordered',
                'partially_received',
                'received',
                'cancelled'
            ),
            allowNull: false,
            defaultValue: 'draft',
        },
        // Financial totals
        subtotal: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        discount_type: { 
            type: DataTypes.ENUM('amount', 'percentage'), 
            defaultValue: 'amount' 
        },
        discount_value: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        discount_amount: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        tax_amount: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        shipping_amount: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        total_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        // Payment
        paid_amount: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        payment_status: {
            type: DataTypes.ENUM('unpaid', 'partial', 'paid'),
            defaultValue: 'unpaid',
        },
        payment_method: { type: DataTypes.STRING(50), allowNull: true },
        // Reference
        reference_number: { type: DataTypes.STRING(100), allowNull: true },
        notes: { type: DataTypes.TEXT, allowNull: true, defaultValue: '' },
        terms: { type: DataTypes.TEXT, allowNull: true, defaultValue: '' },
        // Receiving
        received_date: { type: DataTypes.DATEONLY, allowNull: true },
        // Audit
        created_by: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'users', key: 'id' },
            onDelete: 'SET NULL',
        },
        // ✅ For offline sync
        local_uuid: { type: DataTypes.STRING(100), allowNull: true, unique: true },
    }, {
        tableName: 'purchase_orders',
        timestamps: true,
        underscored: false,
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
        indexes: [
            { fields: ['po_number'] },
            { fields: ['supplier_id'] },
            { fields: ['status'] },
            { fields: ['order_date'] },
            { fields: ['local_uuid'] },
        ],
    });

    return PurchaseOrder;
};