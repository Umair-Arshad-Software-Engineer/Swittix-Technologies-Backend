const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Category = sequelize.define('Category', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: {
            type: DataTypes.STRING(100),
            allowNull: false,
            unique: true,
            validate: {
                notEmpty: { msg: 'Category name is required' },
                len: { args: [2, 100], msg: 'Category name must be between 2 and 100 characters' },
            },
        },
        description: { type: DataTypes.TEXT, allowNull: true },
        created_by: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'users', key: 'id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
        },
    }, {
        tableName: 'categories',
        timestamps: true,
        underscored: false,      // ✅ was true — FIXED
        createdAt: 'createdAt',  // ✅ added
        updatedAt: 'updatedAt',  // ✅ added
        indexes: [
            { fields: ['name'] },
            { fields: ['created_by'] },
        ],
    });

    return Category;
};