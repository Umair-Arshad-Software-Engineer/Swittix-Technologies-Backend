

const { DataTypes } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    const Sale = sequelize.define('Sale', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        // ── NEW: offline-sync support ───────────────────────────────────────
        local_uuid: {
            type: DataTypes.STRING(36),
            allowNull: false,
            unique: true, // prevents duplicate insert if branch retries sync
        },
        branch_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: {
                model: 'branches',
                key: 'id'
            }
        },
        is_synced: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true, // sale created directly on server = already synced
        },
        // ── existing fields ──────────────────────────────────────────────────
        total_price: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            validate: {
                isDecimal: { msg: 'Total price must be a valid number' },
                min: { args: [0], msg: 'Total price cannot be negative' }
            }
        },
        // ✅ Add total_tax field
        total_tax: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0,
            validate: {
                isDecimal: { msg: 'Total tax must be a valid number' },
                min: { args: [0], msg: 'Total tax cannot be negative' }
            }
        },
        discount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0,
            validate: {
                min: { args: [0], msg: 'Discount cannot be negative' }
            }
        },
        customer_name: {
            type: DataTypes.STRING(100),
            allowNull: true,
            validate: {
                len: { args: [0, 100], msg: 'Customer name must be less than 100 characters' }
            }
        },
        customer_phone: {
            type: DataTypes.STRING(20),
            allowNull: true,
            validate: {
                len: { args: [0, 20], msg: 'Phone number must be less than 20 characters' }
            }
        },
        sale_date: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
            validate: {
                isDate: { msg: 'Invalid date format' }
            }
        },
        sold_by: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
            validate: {
                notNull: { msg: 'Seller information is required' }
            }
        }
    }, {
         tableName: 'sales',
        timestamps: true,
        underscored: false,
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
        indexes: [
            { fields: ['sale_date'] },
            { fields: ['sold_by'] },
            { fields: ['branch_id'] },
            { fields: ['local_uuid'] },
        ]
    });

    // ── Static methods ────────────────────────────────────────────────────────

    Sale.getReport = async function(start_date, end_date, branch_id) {
        let whereClause = {};
        if (start_date && end_date) {
            whereClause.sale_date = {
                [sequelize.Sequelize.Op.between]: [
                    new Date(start_date),
                    new Date(end_date)
                ]
            };
        }
        if (branch_id) {
            whereClause.branch_id = branch_id;
        }

        return await this.findAll({
            attributes: [
                [sequelize.fn('DATE', sequelize.col('sale_date')), 'date'],
                [sequelize.fn('COUNT', sequelize.col('Sale.id')), 'total_sales'],
                [sequelize.fn('SUM', sequelize.col('total_price')), 'total_revenue'],
                [sequelize.fn('AVG', sequelize.col('total_price')), 'average_sale_value']
            ],
            where: whereClause,
            group: [sequelize.fn('DATE', sequelize.col('sale_date'))],
            order: [[sequelize.fn('DATE', sequelize.col('sale_date')), 'DESC']],
            raw: true
        });
    };

    Sale.getSellerPerformance = async function(start_date, end_date) {
        let whereClause = {};
        if (start_date && end_date) {
            whereClause = {
                sale_date: {
                    [sequelize.Sequelize.Op.between]: [
                        new Date(start_date),
                        new Date(end_date)
                    ]
                }
            };
        }

        return await this.findAll({
            attributes: [
                'sold_by',
                [sequelize.fn('COUNT', sequelize.col('Sale.id')), 'total_sales'],
                [sequelize.fn('SUM', sequelize.col('total_price')), 'total_revenue'],
            ],
            where: whereClause,
            include: [{
                association: 'seller',
                attributes: ['name', 'email']
            }],
            group: ['sold_by', 'seller.id'],
            order: [[sequelize.literal('total_revenue'), 'DESC']]
        });
    };

    return Sale;
};