// src/models/invoice.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Invoice = sequelize.define('Invoice', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        invoice_number: { 
            type: DataTypes.STRING(50), 
            allowNull: false, 
            unique: true 
        },
        invoice_number_auto: { 
            type: DataTypes.BOOLEAN, 
            allowNull: false, 
            defaultValue: true 
        },
        bilti_number: { 
            type: DataTypes.STRING(100), 
            allowNull: true 
        },
        description: { 
            type: DataTypes.TEXT, 
            allowNull: true, 
            defaultValue: '' 
        },
        transport_company: { 
            type: DataTypes.STRING(200), 
            allowNull: true 
        },
        invoice_date: { 
            type: DataTypes.DATEONLY, 
            allowNull: false,
            defaultValue: DataTypes.NOW
        },
        customer_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'customers', key: 'id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
        },
        customer_name: {
            type: DataTypes.STRING(200),
            allowNull: true,
        },
        customer_phone: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        // Financial fields
        subtotal: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
        },
        discount_type: {
            type: DataTypes.ENUM('percentage', 'amount'),
            allowNull: false,
            defaultValue: 'amount',
        },
        discount_value: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
        },
        discount_amount: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
        },
        labour_amount: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
        },
        tax_amount: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
        },
        total_amount: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
        },
        // Metadata
        branch_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'branches', key: 'id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
        },
        created_by: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'users', key: 'id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
        },
        status: {
            type: DataTypes.ENUM('draft', 'confirmed', 'cancelled'),
            allowNull: false,
            defaultValue: 'confirmed',
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true,
            defaultValue: '',
        },
        local_uuid: {
            type: DataTypes.STRING(100),
            allowNull: true,
            unique: true,
        },
    }, {
        tableName: 'invoices',
        timestamps: true,
        underscored: false,
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
        indexes: [
            { fields: ['invoice_number'] },
            { fields: ['customer_id'] },
            { fields: ['invoice_date'] },
            { fields: ['branch_id'] },
            { fields: ['created_by'] },
            { fields: ['local_uuid'] },
        ],
    });

    return Invoice;
};