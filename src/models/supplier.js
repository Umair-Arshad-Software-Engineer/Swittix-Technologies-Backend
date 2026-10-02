// src/models/supplier.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Supplier = sequelize.define('Supplier', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: {
            type: DataTypes.STRING(100),
            allowNull: false,
            validate: {
                notEmpty: { msg: 'Supplier name is required' },
                len: { args: [1, 100], msg: 'Supplier name must be between 1 and 100 characters' },
            },
        },
        company: {
            type: DataTypes.STRING(100),
            allowNull: true,
        },
        phone: {
            type: DataTypes.STRING(20),
            allowNull: true,
        },
        email: {
            type: DataTypes.STRING(100),
            allowNull: true,
        },
        address: {
            type: DataTypes.TEXT,
            allowNull: true,
            defaultValue: '',
        },
        city: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        cnic: {
            type: DataTypes.STRING(20),
            allowNull: true,
        },
        tax_number: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        opening_balance: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0,
        },
        current_balance: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0,
        },
        credit_limit: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0,
        },
        is_active: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true,
            defaultValue: '',
        },
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
    }, {
        tableName: 'suppliers',
        timestamps: true,
        underscored: false,
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
        indexes: [
            { fields: ['name'] },
            { fields: ['phone'] },
            { fields: ['company'] },
            { fields: ['created_by'] },
            { fields: ['branch_id'] },
        ],
    });

    return Supplier;
};