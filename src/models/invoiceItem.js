// src/models/invoiceItem.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const InvoiceItem = sequelize.define('InvoiceItem', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        invoice_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'invoices', key: 'id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
        },
        product_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'products', key: 'id' },
            onDelete: 'RESTRICT',
            onUpdate: 'CASCADE',
        },
        product_name: {
            type: DataTypes.STRING(200),
            allowNull: false,
        },
        product_item_code: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        product_unit: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
            defaultValue: '',
        },
        quantity: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 1,
        },
        unit_price: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
        },
        // Track if custom price was applied
        is_custom_price: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        original_price: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: true,
        },
        // Discount per item
        discount_percentage: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: false,
            defaultValue: 0,
        },
        discount_amount: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
        },
        tax_percentage: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: false,
            defaultValue: 0,
        },
        tax_amount: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
        },
        subtotal: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
        },
        total: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
        },
    }, {
        tableName: 'invoice_items',
        timestamps: true,
        underscored: false,
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
        indexes: [
            { fields: ['invoice_id'] },
            { fields: ['product_id'] },
        ],
    });

    return InvoiceItem;
};