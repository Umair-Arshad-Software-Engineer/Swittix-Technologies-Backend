const { DataTypes } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    const Branch = sequelize.define('Branch', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        name: {
            type: DataTypes.STRING(100),
            allowNull: false,
            validate: {
                notEmpty: { msg: 'Branch name is required' },
                len: { args: [2, 100], msg: 'Branch name must be between 2 and 100 characters' }
            }
        },
        address: {
            type: DataTypes.TEXT,
            allowNull: false,
            validate: {
                notEmpty: { msg: 'Address is required' }
            }
        },
        phone: {
            type: DataTypes.STRING(20),
            allowNull: false,
            validate: {
                notEmpty: { msg: 'Phone number is required' },
                is: {
                    args: /^[0-9+\-\s()]+$/,
                    msg: 'Please provide a valid phone number'
                }
            }
        },
        is_active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        },
        created_by: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            }
        }
    }, {
        tableName: 'branches',
        timestamps: true,
        underscored: false,
    });

    Branch.associate = (models) => {
        Branch.belongsTo(models.User, {
            foreignKey: 'created_by',
            as: 'creator'
        });

        // ✅ NEW — reverse of User.belongsTo(Branch): one branch has many users
        Branch.hasMany(models.User, {
            foreignKey: 'branch_id',
            as: 'users'
        });
    };

    return Branch;
};